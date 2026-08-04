import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = connectionString ? describe : describe.skip;
const schema = `town_map_saved_api_test_${process.pid}`;

/** Set per test so an unauthenticated request can be exercised too. */
let currentUserId: string | null = "user_test";

vi.mock("@clerk/fastify", () => ({
  clerkPlugin: async () => {},
  getAuth: () => ({ isAuthenticated: Boolean(currentUserId), userId: currentUserId }),
  clerkClient: { users: { updateUserMetadata: vi.fn().mockResolvedValue({}) } },
}));

let app: Awaited<ReturnType<typeof import("./app.js").createApp>>;
let client: Client;

const MISSING_EVENT_ID = "00000000-0000-4000-8000-000000000000";

/**
 * Deliberately sends no body and no content type. A save carries nothing but its
 * URL, and declaring JSON on an empty body is rejected by Fastify before it
 * reaches the handler.
 */
async function save(eventId: string) {
  return app.inject({
    method: "PUT",
    url: `/v1/saved-events/${eventId}`,
    headers: { authorization: "Bearer test-token" },
  });
}

async function remove(eventId: string) {
  return app.inject({
    method: "DELETE",
    url: `/v1/saved-events/${eventId}`,
    headers: { authorization: "Bearer test-token" },
  });
}

async function list() {
  return app.inject({
    method: "GET",
    url: "/v1/saved-events",
    headers: { authorization: "Bearer test-token" },
  });
}

async function createEvent(sourceEventId: string, startsAt: string) {
  const result = await client.query<{ id: string }>(
    `INSERT INTO events (source, source_event_id, game, title, starts_at)
     VALUES ('wotc-locator', $1, 'magic', $2, $3)
     RETURNING id`,
    [sourceEventId, `Event ${sourceEventId}`, startsAt],
  );
  return result.rows[0].id;
}

integration("/v1/saved-events", () => {
  beforeAll(async () => {
    client = new Client({ connectionString });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    const { applyMigrations } = await import("@town-map/db/migrations");
    await applyMigrations(client);

    const url = new URL(connectionString!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    process.env.CLERK_PUBLISHABLE_KEY = "pk_test_x";
    process.env.CLERK_SECRET_KEY = "sk_test_x";

    app = await (await import("./app.js")).createApp();
  }, 60_000);

  beforeEach(async () => {
    currentUserId = "user_test";
    await client.query("DELETE FROM events");
  });

  afterAll(async () => {
    await app?.close();
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  });

  it("requires authentication to read the list", async () => {
    currentUserId = null;
    expect((await list()).statusCode).toBe(401);
  });

  it("requires authentication to save", async () => {
    currentUserId = null;
    expect((await save(MISSING_EVENT_ID)).statusCode).toBe(401);
  });

  it("saves an event and returns it in the list", async () => {
    const id = await createEvent("a", "2035-06-01T18:00:00.000Z");

    expect((await save(id)).statusCode).toBe(204);

    const response = await list();
    expect(response.statusCode).toBe(200);
    expect(response.json().events.map((event: { id: string }) => event.id)).toEqual([id]);
    expect(response.json().count).toBe(1);
  });

  it("accepts the same save twice", async () => {
    const id = await createEvent("a", "2035-06-01T18:00:00.000Z");

    expect((await save(id)).statusCode).toBe(204);
    expect((await save(id)).statusCode).toBe(204);

    expect((await list()).json().count).toBe(1);
  });

  it("rejects an event id that is not a UUID", async () => {
    expect((await save("not-a-uuid")).statusCode).toBe(400);
  });

  it("reports an unknown event as missing rather than saving it", async () => {
    expect((await save(MISSING_EVENT_ID)).statusCode).toBe(404);
  });

  it("removes a save, and removing it again is still fine", async () => {
    const id = await createEvent("a", "2035-06-01T18:00:00.000Z");
    await save(id);

    expect((await remove(id)).statusCode).toBe(204);
    expect((await list()).json().count).toBe(0);
    expect((await remove(id)).statusCode).toBe(204);
  });

  it("never lets a saved list be cached", async () => {
    expect((await list()).headers["cache-control"]).toBe("no-store");
  });

  it("keeps another account's saves out of the list", async () => {
    const id = await createEvent("a", "2035-06-01T18:00:00.000Z");
    currentUserId = "user_other";
    await save(id);

    currentUserId = "user_test";
    expect((await list()).json().count).toBe(0);
  });
});
