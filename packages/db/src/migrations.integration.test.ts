import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, readMigrations } from "./migrations.js";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = connectionString ? describe : describe.skip;
const schema = `town_map_migrations_test_${process.pid}`;
let client: Client;

integration("migration ledger", () => {
  beforeAll(async () => {
    client = new Client({ connectionString });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  });

  it("applies every migration once and records it", async () => {
    const expected = (await readMigrations()).map((migration) => migration.filename);

    await expect(applyMigrations(client)).resolves.toEqual(expected);

    const ledger = await client.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations ORDER BY filename",
    );
    expect(ledger.rows.map((row) => row.filename)).toEqual(expected);
  }, 60_000);

  it("is a no-op on a second run", async () => {
    await expect(applyMigrations(client)).resolves.toEqual([]);
  }, 60_000);

  it("releases the lock so a later run can acquire it", async () => {
    const held = await client.query<{ held: boolean }>(
      "SELECT count(*) > 0 AS held FROM pg_locks WHERE locktype = 'advisory'",
    );
    expect(held.rows[0].held).toBe(false);
  }, 15_000);

  it("refuses to run when an applied migration has been edited", async () => {
    const [first] = await readMigrations();
    await client.query(
      "UPDATE schema_migrations SET checksum = 'tampered' WHERE filename = $1",
      [first.filename],
    );

    await expect(applyMigrations(client)).rejects.toThrow(/was modified after it was applied/);

    await client.query(
      "UPDATE schema_migrations SET checksum = $2 WHERE filename = $1",
      [first.filename, first.checksum],
    );
  });

  it("rolls back a failed transactional migration without recording it", async () => {
    await client.query(
      "DELETE FROM schema_migrations WHERE filename IN ($1, $2)",
      ["009_denormalize_event_coordinates.sql", "010_add_event_geo_indexes.sql"],
    );
    await client.query("DROP INDEX IF EXISTS events_game_geo_idx");
    await client.query("DROP INDEX IF EXISTS events_geo_idx");
    await client.query("ALTER TABLE events DROP COLUMN latitude, DROP COLUMN longitude");
    // Poison the replay: 009 skips adding `latitude` because a column of that
    // name already exists, adds `longitude`, then fails on the backfill because
    // there is no assignment cast from double precision to boolean.
    await client.query("ALTER TABLE events ADD COLUMN latitude boolean");

    await expect(applyMigrations(client)).rejects.toThrow();

    const ledger = await client.query<{ count: string }>(
      "SELECT count(*)::text FROM schema_migrations WHERE filename = '009_denormalize_event_coordinates.sql'",
    );
    expect(ledger.rows[0].count).toBe("0");

    // The column 009 managed to add before failing must be gone, proving the
    // whole migration rolled back rather than leaving the schema half-applied.
    const columns = await client.query<{ count: string }>(
      `SELECT count(*)::text FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'events' AND column_name = 'longitude'`,
      [schema],
    );
    expect(columns.rows[0].count).toBe("0");
  });
});
