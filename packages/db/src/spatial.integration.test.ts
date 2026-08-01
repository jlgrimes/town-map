import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listEvents } from "./index.js";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = connectionString ? describe : describe.skip;
const schema = `town_map_spatial_test_${process.pid}`;
const migrationsDirectory = fileURLToPath(new URL("../migrations", import.meta.url));
let client: Client;

integration("global-scale event lookup", () => {
  beforeAll(async () => {
    client = new Client({ connectionString });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    await client.query("SELECT pg_advisory_lock(8042026)");
    try {
      for (const migration of ["001_initial.sql", "002_add_source_url.sql", "003_add_spatial_query_indexes.sql", "004_add_collection_regions.sql", "005_add_user_preferences.sql"]) {
        await client.query(await readFile(`${migrationsDirectory}/${migration}`, "utf8"));
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(8042026)");
    }

    await client.query(`
      INSERT INTO venues (source, source_venue_id, name, latitude, longitude)
      SELECT
        'wotc-locator',
        'global-' || value,
        'Venue ' || value,
        -80 + ((value * 97) % 16000) / 100.0,
        -180 + ((value * 137) % 36000) / 100.0
      FROM generate_series(1, 100000) AS value;

      INSERT INTO events (source, source_event_id, game, venue_id, title, starts_at, source_url)
      SELECT
        'wotc-locator',
        'global-' || row_number() OVER (),
        'magic',
        id,
        'Event ' || source_venue_id,
        timestamptz '2030-01-01 12:00:00+00' + (row_number() OVER () || ' minutes')::interval,
        'https://example.com/' || source_venue_id
      FROM venues;

      WITH inserted AS (
        INSERT INTO venues (source, source_venue_id, name, latitude, longitude)
        VALUES
          ('wotc-locator', 'near-1', 'Chicago Center', 41.8781, -87.6298),
          ('wotc-locator', 'near-2', 'Nearby Store', 41.90, -87.64),
          ('wotc-locator', 'far-1', 'New York Store', 40.7128, -74.0060),
          ('wotc-locator', 'unknown-1', 'Unknown Store', NULL, NULL)
        RETURNING id, source_venue_id
      )
      INSERT INTO events (source, source_event_id, game, venue_id, title, starts_at, source_url)
      SELECT
        'wotc-locator', source_venue_id, 'magic', id, source_venue_id,
        timestamptz '2028-01-01 12:00:00+00', 'https://example.com/' || source_venue_id
      FROM inserted;

      ANALYZE venues;
      ANALYZE events;
    `);
  }, 30_000);

  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  });

  it("returns only nearby located events and uses coordinate and venue indexes at global scale", async () => {
    let capturedSql = "";
    let capturedValues: unknown[] = [];
    const database = {
      query: async (sql: string, values?: unknown[]) => {
        capturedSql = sql;
        capturedValues = values ?? [];
        return client.query(sql, values);
      },
    } as unknown as Pick<Pool, "query">;

    const page = await listEvents({
      games: ["magic"],
      latitude: 41.8781,
      longitude: -87.6298,
      radiusMiles: 25,
      limit: 200,
    }, database);

    expect(page.events.map((event) => event.title)).toEqual(["near-1", "near-2"]);
    expect(page.events.every((event) => event.distanceMiles !== null && event.distanceMiles <= 25)).toBe(true);

    const explanation = await client.query<{ "QUERY PLAN": unknown }>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${capturedSql}`,
      capturedValues,
    );
    const plan = JSON.stringify(explanation.rows[0]["QUERY PLAN"]);
    expect(plan).toContain("venues_coordinates_idx");
    expect(plan).toContain("events_venue_id_idx");
  }, 10_000);
});
