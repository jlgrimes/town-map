import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { clerkClient, clerkPlugin, getAuth } from "@clerk/fastify";
import { EventIdSchema, EventQuerySchema, UserPreferencesUpdateSchema, type GameRegistry } from "@town-map/contracts";
import { eventsWithPlayerFormats, savedEventsWithPlayerFormats } from "./player-format.js";
import {
  closePool,
  getPool,
  getUserPreferences,
  InvalidEventCursorError,
  listCoverage,
  listEvents,
  listGameRegistry,
  listSavedEvents,
  saveEvent,
  saveUserPreferences,
  unsaveEvent,
} from "@town-map/db";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";

/**
 * Builds the configured server without binding a port, so tests can drive it
 * through `inject()` and each gets its own instance.
 */
export async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      redact: ["req.headers.authorization", "req.headers.cookie", "req.headers['set-cookie']"],
    },
  });
  const configuredOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const nativeOrigins = new Set(["capacitor://localhost", "http://localhost", "https://localhost"]);
  const clerkConfigured = Boolean(process.env.CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
  const geocoderUrl = (process.env.GEOCODER_URL ?? "https://nominatim.openstreetmap.org").replace(/\/$/, "");
  const geocoderUserAgent = process.env.GEOCODER_USER_AGENT ?? "TownMap/1.0 (https://town-map-eight.vercel.app)";
  const geocodeCache = new Map<string, { expiresAt: number; value: HomeLocation }>();
  let geocodeQueue: Promise<void> = Promise.resolve();
  let nextGeocodeRequestAt = 0;

  type HomeLocation = {
    address: string;
    label: string;
    latitude: number;
    longitude: number;
  };

  await app.register(cors, {
    methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
    origin(origin, callback) {
      if (!origin || configuredOrigins.includes(origin) || nativeOrigins.has(origin)) callback(null, true);
      else callback(new Error("Origin is not allowed"), false);
    },
  });

  await app.register(rateLimit, {
    global: true,
    max: Number(process.env.RATE_LIMIT_MAX ?? 300),
    timeWindow: process.env.RATE_LIMIT_WINDOW ?? "1 minute",
    allowList: (request) => request.url === "/health",
  });

  function rateLimited(max: number) {
    return { rateLimit: { max, timeWindow: process.env.RATE_LIMIT_WINDOW ?? "1 minute" } };
  }

  function publicCache(seconds: number, staleWhileRevalidateSeconds = seconds * 5) {
    return `public, max-age=${seconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`;
  }

  if (clerkConfigured) {
    await app.register(clerkPlugin, {
      publishableKey: process.env.CLERK_PUBLISHABLE_KEY!,
      secretKey: process.env.CLERK_SECRET_KEY!,
    });
  }

  function authenticatedUserId(request: FastifyRequest, reply: FastifyReply) {
    if (!clerkConfigured) {
      reply.code(503).send({ error: "Authentication is not configured." });
      return null;
    }
    const auth = getAuth(request, { acceptsToken: "session_token" });
    if (!auth.isAuthenticated || !auth.userId) {
      reply.code(401).send({ error: "Authentication is required." });
      return null;
    }
    return auth.userId;
  }

  const revision = process.env.RAILWAY_GIT_COMMIT_SHA
    ?? process.env.GIT_COMMIT_SHA
    ?? process.env.SOURCE_COMMIT
    ?? null;

  app.get("/health", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    const revisionField = { revision: revision?.slice(0, 12) ?? "unknown" };
    if (!process.env.DATABASE_URL) {
      return reply.code(503).send({ status: "degraded", database: "not-configured", ...revisionField });
    }
    try {
      await getPool().query("SELECT 1");
      return { status: "ok", database: "connected", ...revisionField };
    } catch {
      return reply.code(503).send({ status: "degraded", database: "unavailable", ...revisionField });
    }
  });

  const registryTtlMs = Number(process.env.GAME_REGISTRY_TTL_MS ?? 300_000);
  let registryCache: { expiresAt: number; value: GameRegistry } | undefined;

  async function gameRegistry(): Promise<GameRegistry> {
    if (registryCache && registryCache.expiresAt > Date.now()) return registryCache.value;
    const value = await listGameRegistry();
    registryCache = { expiresAt: Date.now() + registryTtlMs, value };
    return value;
  }

  app.get("/v1/games", async (_request, reply) => {
    if (!process.env.DATABASE_URL) {
      reply.header("Cache-Control", "no-store");
      return reply.code(503).send({ error: "The event database is not configured." });
    }
    reply.header("Cache-Control", publicCache(300));
    return gameRegistry();
  });

  app.get("/v1/coverage", async (_request, reply) => {
    if (!process.env.DATABASE_URL) {
      reply.header("Cache-Control", "no-store");
      return reply.code(503).send({ error: "The event database is not configured." });
    }
    reply.header("Cache-Control", publicCache(60));
    return listCoverage();
  });

  async function geocodePlace(query: string): Promise<HomeLocation | null> {
    const cacheKey = query.toLocaleLowerCase();
    const cached = geocodeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    let releaseQueue: () => void = () => undefined;
    const previousRequest = geocodeQueue;
    geocodeQueue = new Promise<void>((resolve) => { releaseQueue = resolve; });
    await previousRequest;

    try {
      const queuedCached = geocodeCache.get(cacheKey);
      if (queuedCached && queuedCached.expiresAt > Date.now()) return queuedCached.value;
      const waitMilliseconds = Math.max(0, nextGeocodeRequestAt - Date.now());
      if (waitMilliseconds > 0) await new Promise((resolve) => setTimeout(resolve, waitMilliseconds));
      nextGeocodeRequestAt = Date.now() + 1_100;

      const params = new URLSearchParams({ q: query, format: "jsonv2", limit: "1", addressdetails: "1" });
      const response = await fetch(`${geocoderUrl}/search?${params}`, {
        headers: {
          Accept: "application/json",
          Referer: "https://town-map-eight.vercel.app/",
          "User-Agent": geocoderUserAgent,
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Nominatim returned ${response.status}`);
      const results = await response.json() as Array<{
        lat: string;
        lon: string;
        display_name: string;
        name?: string;
        address?: { city?: string; town?: string; village?: string; state?: string };
      }>;
      const result = results[0];
      if (!result) return null;
      const city = result.address?.city ?? result.address?.town ?? result.address?.village ?? result.name;
      const value: HomeLocation = {
        latitude: Number(result.lat),
        longitude: Number(result.lon),
        label: [city, result.address?.state].filter(Boolean).join(", ") || result.display_name.split(",").slice(0, 2).join(","),
        address: result.display_name,
      };
      geocodeCache.set(cacheKey, { expiresAt: Date.now() + 24 * 60 * 60 * 1_000, value });
      if (geocodeCache.size > 1_000) geocodeCache.delete(geocodeCache.keys().next().value!);
      return value;
    } finally {
      releaseQueue();
    }
  }

  app.get<{ Querystring: { q?: string } }>("/v1/geocode", {
    config: rateLimited(Number(process.env.RATE_LIMIT_GEOCODE_MAX ?? 20)),
  }, async (request, reply) => {
    const query = request.query.q?.trim();
    reply.header("Cache-Control", "no-store");
    if (!query || query.length > 500) return reply.code(400).send({ error: "Enter a valid place." });
    try {
      const result = await geocodePlace(query);
      if (!result) return reply.code(404).send({ error: "Place not found." });
      reply.header("Cache-Control", publicCache(86_400));
      return result;
    } catch (error) {
      request.log.warn({ error }, "Geocoding request failed");
      return reply.code(502).send({ error: "Place search is temporarily unavailable." });
    }
  });

  app.get("/v1/preferences", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const userId = authenticatedUserId(request, reply);
    if (!userId) return;
    if (!process.env.DATABASE_URL) {
      return reply.code(503).send({ error: "The event database is not configured." });
    }
    return getUserPreferences(userId);
  });

  app.put<{ Body: unknown }>("/v1/preferences", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const userId = authenticatedUserId(request, reply);
    if (!userId) return;
    if (!process.env.DATABASE_URL) {
      return reply.code(503).send({ error: "The event database is not configured." });
    }
    const parsed = UserPreferencesUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid preferences", details: parsed.error.flatten() });
    }
    const knownGames = new Set((await gameRegistry()).games.map((game) => game.id));
    const unknownGames = parsed.data.selectedGames.filter((game) => !knownGames.has(game));
    if (unknownGames.length) {
      return reply.code(400).send({ error: `Unknown game: ${unknownGames.join(", ")}` });
    }
    const preferences = await saveUserPreferences(userId, parsed.data.homeAddress, parsed.data.selectedGames);
    try {
      await clerkClient.users.updateUserMetadata(userId, {
        publicMetadata: {
          selectedGames: parsed.data.selectedGames,
          onboardingCompleted: true,
        },
      });
    } catch (error) {
      request.log.error({ error, userId }, "Stored preferences but failed to mirror them to Clerk metadata");
    }
    return preferences;
  });

  app.get("/v1/saved-events", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const userId = authenticatedUserId(request, reply);
    if (!userId) return;
    if (!process.env.DATABASE_URL) {
      return reply.code(503).send({ error: "The event database is not configured." });
    }
    return savedEventsWithPlayerFormats(await listSavedEvents(userId));
  });

  app.put<{ Params: { eventId: string } }>("/v1/saved-events/:eventId", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const userId = authenticatedUserId(request, reply);
    if (!userId) return;
    const eventId = EventIdSchema.safeParse(request.params.eventId);
    if (!eventId.success) return reply.code(400).send({ error: "Invalid event id." });
    if (!process.env.DATABASE_URL) {
      return reply.code(503).send({ error: "The event database is not configured." });
    }
    if (!await saveEvent(userId, eventId.data)) {
      return reply.code(404).send({ error: "That event is no longer available." });
    }
    return reply.code(204).send();
  });

  app.delete<{ Params: { eventId: string } }>("/v1/saved-events/:eventId", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const userId = authenticatedUserId(request, reply);
    if (!userId) return;
    const eventId = EventIdSchema.safeParse(request.params.eventId);
    if (!eventId.success) return reply.code(400).send({ error: "Invalid event id." });
    if (!process.env.DATABASE_URL) {
      return reply.code(503).send({ error: "The event database is not configured." });
    }
    await unsaveEvent(userId, eventId.data);
    return reply.code(204).send();
  });

  app.get<{ Querystring: Record<string, string | undefined> }>("/v1/events", async (request, reply) => {
    const games = request.query.games?.split(",").filter(Boolean) ?? [];
    const categories = request.query.categories?.split(",").filter(Boolean) ?? [];
    const supplied = Object.fromEntries(
      Object.entries(request.query).filter(([, value]) => value !== undefined && value !== ""),
    );
    const parsed = EventQuerySchema.safeParse({ ...supplied, games, categories });
    reply.header("Cache-Control", "no-store");
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }
    if (!process.env.DATABASE_URL) {
      return reply.code(503).send({ error: "The event database is not configured." });
    }
    try {
      const registry = await gameRegistry();
      const knownGames = new Set(registry.games.map((game) => game.id));
      const knownCategories = new Set(registry.categories.map((category) => category.id));
      const unknown = [
        ...parsed.data.games.filter((game) => !knownGames.has(game)),
        ...parsed.data.categories.filter((category) => !knownCategories.has(category)),
      ];
      if (unknown.length) {
        return reply.code(400).send({ error: `Unknown game or category: ${unknown.join(", ")}` });
      }

      const selectedGames = [...new Set([
        ...parsed.data.games,
        ...registry.games
          .filter((game) => parsed.data.categories.includes(game.category))
          .map((game) => game.id),
      ])];
      if ((parsed.data.games.length || parsed.data.categories.length) && !selectedGames.length) {
        reply.header("Cache-Control", publicCache(60));
        return { events: [], count: 0, nextCursor: null };
      }

      const { categories: _expanded, ...lookup } = parsed.data;
      const page = await listEvents({ ...lookup, games: selectedGames });
      reply.header("Cache-Control", publicCache(60));
      return eventsWithPlayerFormats(page);
    } catch (error) {
      if (error instanceof InvalidEventCursorError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
  });

  app.addHook("onClose", async () => closePool());

  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const status = error.statusCode ?? 500;
    reply.header("Cache-Control", "no-store");
    if (status >= 500) {
      request.log.error({ err: error, requestId: request.id }, "Unhandled request error");
      return reply.code(status).send({ error: "Something went wrong.", requestId: request.id });
    }
    return reply.code(status).send({ error: error.message });
  });

  return app;
}
