import cors from "@fastify/cors";
import { clerkClient, clerkPlugin, getAuth } from "@clerk/fastify";
import { EventQuerySchema, GAME_LABELS, GameSchema, UserPreferencesUpdateSchema } from "@town-map/contracts";
import {
  closePool,
  getPool,
  getUserPreferences,
  InvalidEventCursorError,
  listCoverage,
  listEvents,
  saveUserPreferences,
} from "@town-map/db";
import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from "fastify";

const app = Fastify({
  logger: {
    // Session tokens and cookies must never reach the log sink.
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
  methods: ["GET", "HEAD", "POST", "PUT", "OPTIONS"],
  origin(origin, callback) {
    if (!origin || configuredOrigins.includes(origin) || nativeOrigins.has(origin)) callback(null, true);
    else callback(new Error("Origin is not allowed"), false);
  },
});

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

app.get("/health", async (_request, reply) => {
  if (!process.env.DATABASE_URL) {
    return reply.code(503).send({ status: "degraded", database: "not-configured" });
  }
  try {
    await getPool().query("SELECT 1");
    return { status: "ok", database: "connected" };
  } catch {
    return reply.code(503).send({ status: "degraded", database: "unavailable" });
  }
});

app.get("/v1/games", async () => ({
  games: GameSchema.options.map((id) => ({ id, label: GAME_LABELS[id] })),
}));

app.get("/v1/coverage", async (_request, reply) => {
  if (!process.env.DATABASE_URL) {
    return reply.code(503).send({ error: "The event database is not configured." });
  }
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

app.get<{ Querystring: { q?: string } }>("/v1/geocode", async (request, reply) => {
  const query = request.query.q?.trim();
  if (!query || query.length > 500) return reply.code(400).send({ error: "Enter a valid place." });
  try {
    const result = await geocodePlace(query);
    if (!result) return reply.code(404).send({ error: "Place not found." });
    return result;
  } catch (error) {
    request.log.warn({ error }, "Geocoding request failed");
    return reply.code(502).send({ error: "Place search is temporarily unavailable." });
  }
});

app.get("/v1/preferences", async (request, reply) => {
  const userId = authenticatedUserId(request, reply);
  if (!userId) return;
  return getUserPreferences(userId);
});

app.put<{ Body: unknown }>("/v1/preferences", async (request, reply) => {
  const userId = authenticatedUserId(request, reply);
  if (!userId) return;
  const parsed = UserPreferencesUpdateSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid preferences", details: parsed.error.flatten() });
  }
  // PostgreSQL is the source of truth, so it is written first. Mirroring to Clerk
  // afterwards can fail without leaving onboarding marked complete against no
  // stored preferences; the next save reconciles it.
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

app.get<{ Querystring: Record<string, string | undefined> }>("/v1/events", async (request, reply) => {
  const games = request.query.games?.split(",").filter(Boolean) ?? [];
  const parsed = EventQuerySchema.safeParse({ ...request.query, games });
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });
  }
  if (!process.env.DATABASE_URL) {
    return reply.code(503).send({ error: "The event database is not configured." });
  }
  try {
    return await listEvents(parsed.data);
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
  if (status >= 500) {
    // The single place an error-tracking client would be notified from.
    request.log.error({ err: error, requestId: request.id }, "Unhandled request error");
    return reply.code(status).send({ error: "Something went wrong.", requestId: request.id });
  }
  return reply.code(status).send({ error: error.message });
});

// Railway sends SIGTERM on deploy. Without this the process dies immediately and
// in-flight requests are dropped; `close()` drains them and runs the onClose hook.
// Registered before listening so a signal during a slow start is still handled.
const shutdownTimeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 15_000);
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, "Draining connections before shutdown");
    const forceExit = setTimeout(() => {
      app.log.error({ signal }, "Shutdown timed out with requests still in flight");
      process.exit(1);
    }, shutdownTimeoutMs);
    forceExit.unref();
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, "Shutdown failed");
      process.exit(1);
    }
  });
}

const port = Number(process.env.PORT ?? 3001);
await app.listen({ host: "0.0.0.0", port });
