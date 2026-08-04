import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = connectionString ? describe : describe.skip;
const schema = `town_map_api_test_${process.pid}`;

/** Set per test so an unauthenticated request can be exercised too. */
let currentUserId: string | null = "user_test";
const updateUserMetadata = vi.fn().mockResolvedValue({});

vi.mock("@clerk/fastify", () => ({
  clerkPlugin: async () => {},
  getAuth: () => ({ isAuthenticated: Boolean(currentUserId), userId: currentUserId }),
  clerkClient: { users: { updateUserMetadata: (...args: unknown[]) => updateUserMetadata(...args) } },
}));

let app: Awaited<ReturnType<typeof import("./app.js").createApp>>;
let client: Client;

async function putPreferences(body: unknown) {
  return app.inject({
    method: "PUT",
    url: "/v1/preferences",
    headers: { "content-type": "application/json", authorization: "Bearer test-token" },
    payload: JSON.stringify(body),
  });
}

integration("PUT /v1/preferences", () => {
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
    // Presence of both keys is what switches authentication on.
    process.env.CLERK_PUBLISHABLE_KEY = "pk_test_x";
    process.env.CLERK_SECRET_KEY = "sk_test_x";

    app = await (await import("./app.js")).createApp();
  }, 60_000);

  beforeEach(async () => {
    currentUserId = "user_test";
    updateUserMetadata.mockClear().mockResolvedValue({});
    await client.query("DELETE FROM user_preferences");
  });

  afterAll(async () => {
    await app?.close();
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  });

  it("saves a valid selection and returns it", async () => {
    const response = await putPreferences({
      homeAddress: "111 N State St, Chicago, IL",
      selectedGames: ["magic", "pokemon"],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      homeAddress: "111 N State St, Chicago, IL",
      selectedGames: ["magic", "pokemon"],
      onboardingCompleted: true,
    });
  });

  it("persists to PostgreSQL as the source of truth", async () => {
    await putPreferences({ homeAddress: "Chicago, IL", selectedGames: ["yugioh"] });

    const stored = await client.query<{ selectedGames: string[] }>(
      `SELECT selected_games AS "selectedGames" FROM user_preferences WHERE clerk_user_id = 'user_test'`,
    );
    expect(stored.rows[0].selectedGames).toEqual(["yugioh"]);
  });

  it("accepts every game the registry advertises", async () => {
    const registry = await app.inject({ method: "GET", url: "/v1/games" });
    const ids = registry.json().games.map((game: { id: string }) => game.id);

    const response = await putPreferences({ homeAddress: "Chicago, IL", selectedGames: ids });

    expect(response.statusCode).toBe(200);
    expect(response.json().selectedGames).toEqual(ids);
  });

  it("still succeeds when mirroring to Clerk fails", async () => {
    updateUserMetadata.mockRejectedValueOnce(new Error("clerk unavailable"));

    const response = await putPreferences({ homeAddress: "Chicago, IL", selectedGames: ["magic"] });

    expect(response.statusCode).toBe(200);
    const stored = await client.query("SELECT 1 FROM user_preferences WHERE clerk_user_id = 'user_test'");
    expect(stored.rowCount).toBe(1);
  });

  it("rejects a game that is not in the registry", async () => {
    const response = await putPreferences({ homeAddress: "Chicago, IL", selectedGames: ["chess"] });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("chess");
  });

  it("rejects an empty selection", async () => {
    const response = await putPreferences({ homeAddress: "Chicago, IL", selectedGames: [] });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a blank home address", async () => {
    const response = await putPreferences({ homeAddress: "   ", selectedGames: ["magic"] });
    expect(response.statusCode).toBe(400);
  });

  it("requires authentication", async () => {
    currentUserId = null;
    const response = await putPreferences({ homeAddress: "Chicago, IL", selectedGames: ["magic"] });
    expect(response.statusCode).toBe(401);
  });

  it("never allows a preference response to be cached", async () => {
    const response = await putPreferences({ homeAddress: "Chicago, IL", selectedGames: ["magic"] });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("round-trips through GET", async () => {
    await putPreferences({ homeAddress: "Chicago, IL", selectedGames: ["magic", "onepiece"] });

    const response = await app.inject({
      method: "GET",
      url: "/v1/preferences",
      headers: { authorization: "Bearer test-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      homeAddress: "Chicago, IL",
      selectedGames: ["magic", "onepiece"],
      onboardingCompleted: true,
    });
  });
});
