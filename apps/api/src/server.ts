import cors from "@fastify/cors";
import { EventQuerySchema, GAME_LABELS, GameSchema } from "@town-map/contracts";
import { closePool, getPool, listEvents } from "@town-map/db";
import Fastify from "fastify";

const app = Fastify({ logger: true });
const configuredOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const nativeOrigins = new Set(["capacitor://localhost", "http://localhost", "https://localhost"]);

await app.register(cors, {
  origin(origin, callback) {
    if (!origin || configuredOrigins.includes(origin) || nativeOrigins.has(origin)) callback(null, true);
    else callback(new Error("Origin is not allowed"), false);
  },
});

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

app.get<{ Querystring: Record<string, string | undefined> }>("/v1/events", async (request, reply) => {
  const games = request.query.games?.split(",").filter(Boolean) ?? [];
  const parsed = EventQuerySchema.safeParse({ ...request.query, games });
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });
  }
  if (!process.env.DATABASE_URL) {
    return reply.code(503).send({ error: "The event database is not configured." });
  }
  const events = await listEvents(parsed.data);
  return { events, count: events.length };
});

app.addHook("onClose", async () => closePool());

const port = Number(process.env.PORT ?? 3001);
await app.listen({ host: "0.0.0.0", port });
