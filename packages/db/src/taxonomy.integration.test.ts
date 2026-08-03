import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listGameRegistry } from "./index.js";
import { applyMigrations } from "./migrations.js";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = connectionString ? describe : describe.skip;
const schema = `town_map_taxonomy_test_${process.pid}`;
let client: Client;

integration("event taxonomy", () => {
  beforeAll(async () => {
    client = new Client({ connectionString });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    await applyMigrations(client);
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  });

  it("seeds the card games under one category, ordered for display", async () => {
    const registry = await listGameRegistry(client);

    expect(registry.categories).toEqual([{ id: "card-game", label: "Card games" }]);
    expect(registry.games.map((game) => game.id)).toEqual([
      "pokemon", "magic", "yugioh", "onepiece", "riftbound",
    ]);
    expect(registry.games.every((game) => game.category === "card-game")).toBe(true);
    expect(registry.games.find((game) => game.id === "yugioh")?.label).toBe("Yu-Gi-Oh!");
  });

  it("accepts a new category and game as data, with no schema change", async () => {
    await client.query("INSERT INTO categories (slug, label, position) VALUES ('music', 'Live music', 20)");
    await client.query(
      "INSERT INTO games (slug, category_slug, label, position) VALUES ('jazz', 'music', 'Jazz', 10)",
    );
    await client.query("INSERT INTO sources (slug, label) VALUES ('test-source', 'Test source')");

    // The events CHECK constraint used to reject anything outside five slugs.
    await client.query(
      `INSERT INTO events (source, source_event_id, game, title, starts_at)
       VALUES ('test-source', 'jazz-1', 'jazz', 'Trio at the Green Mill', now() + interval '1 day')`,
    );

    const registry = await listGameRegistry(client);
    expect(registry.categories.map((category) => category.id)).toEqual(["card-game", "music"]);
    expect(registry.games.find((game) => game.id === "jazz")).toEqual({
      id: "jazz", label: "Jazz", category: "music",
    });
  });

  it("rejects an event whose game is not in the taxonomy", async () => {
    await expect(client.query(
      `INSERT INTO events (source, source_event_id, game, title, starts_at)
       VALUES ('test-source', 'bogus-1', 'not-a-game', 'Nope', now())`,
    )).rejects.toThrow(/events_game_fkey/);
  });

  it("rejects an event whose source is not registered", async () => {
    await expect(client.query(
      `INSERT INTO events (source, source_event_id, game, title, starts_at)
       VALUES ('not-a-source', 'bogus-2', 'magic', 'Nope', now())`,
    )).rejects.toThrow(/events_source_fkey/);
  });

  it("hides a disabled game from the registry without touching its events", async () => {
    await client.query("UPDATE games SET enabled = false WHERE slug = 'jazz'");

    const registry = await listGameRegistry(client);
    expect(registry.games.map((game) => game.id)).not.toContain("jazz");

    const retained = await client.query<{ count: string }>(
      "SELECT count(*)::text FROM events WHERE game = 'jazz'",
    );
    expect(retained.rows[0].count).toBe("1");

    await client.query("UPDATE games SET enabled = true WHERE slug = 'jazz'");
  });

  it("no longer constrains selected games to a hardcoded list", async () => {
    await client.query(
      `INSERT INTO user_preferences (clerk_user_id, home_address, selected_games)
       VALUES ('user_taxonomy', '111 N State St', ARRAY['jazz', 'magic'])`,
    );
    const stored = await client.query<{ selectedGames: string[] }>(
      `SELECT selected_games AS "selectedGames" FROM user_preferences WHERE clerk_user_id = 'user_taxonomy'`,
    );
    expect(stored.rows[0].selectedGames).toEqual(["jazz", "magic"]);
  });
});
