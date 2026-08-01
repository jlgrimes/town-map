import cors from "@fastify/cors";
import { clerkPlugin, getAuth } from "@clerk/fastify";
import { EventQuerySchema, GAME_LABELS, GameSchema, HomeLocationSchema } from "@town-map/contracts";
import {
  closePool,
  getPool,
  getUserPreferences,
  InvalidEventCursorError,
  listCoverage,
  listEvents,
  saveUserPreferences,
} from "@town-map/db";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";

const app = Fastify({ logger: true });
const configuredOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const nativeOrigins = new Set(["capacitor://localhost", "http://localhost", "https://localhost"]);
const clerkConfigured = Boolean(process.env.CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

await app.register(cors, {
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

app.get("/v1/preferences", async (request, reply) => {
  const userId = authenticatedUserId(request, reply);
  if (!userId) return;
  return getUserPreferences(userId);
});

app.put<{ Body: unknown }>("/v1/preferences", async (request, reply) => {
  const userId = authenticatedUserId(request, reply);
  if (!userId) return;
  const parsed = HomeLocationSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid home location", details: parsed.error.flatten() });
  }
  return saveUserPreferences(userId, parsed.data);
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

const port = Number(process.env.PORT ?? 3001);
await app.listen({ host: "0.0.0.0", port });
