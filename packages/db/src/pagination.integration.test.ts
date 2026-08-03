import type { Pool } from "pg";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listEvents, type EventLookup } from "./index.js";
import { applyMigrations } from "./migrations.js";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = connectionString ? describe : describe.skip;
const schema = `town_map_pagination_test_${process.pid}`;
let client: Client;
let database: Pick<Pool, "query">;

const TOTAL_EVENTS = 450;

async function walk(query: Omit<EventLookup, "cursor">) {
  const ids: string[] = [];
  const distances: Array<number | null> = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await listEvents({ ...query, cursor }, database);
    ids.push(...page.events.map((event) => event.id));
    distances.push(...page.events.map((event) => event.distanceMiles));
    cursor = page.nextCursor ?? undefined;
    pages += 1;
  } while (cursor && pages < 50);
  return { ids, distances, pages };
}

integration("cursor pagination", () => {
  beforeAll(async () => {
    client = new Client({ connectionString });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    await applyMigrations(client);
    database = { query: (sql: string, values?: unknown[]) => client.query(sql, values) } as never;

    // Microsecond-precision timestamps, many of them identical, all at the same
    // handful of distances. A cursor that loses precision or omits a tiebreaker
    // repeats rows at every page boundary.
    await client.query(`
      INSERT INTO venues (source, source_venue_id, name, latitude, longitude)
      SELECT 'wotc-locator', 'v-' || g, 'Venue ' || g,
        41.8781 + (g % 5) * 0.01, -87.6298 + (g % 4) * 0.01
      FROM generate_series(1, 45) g;

      INSERT INTO events (source, source_event_id, game, venue_id, title, starts_at, latitude, longitude)
      SELECT 'wotc-locator', 'e-' || v.id || '-' || s, 'magic', v.id, 'Event ' || s,
        timestamptz '2035-01-01 12:00:00.123456+00' + make_interval(mins => s % 3),
        v.latitude, v.longitude
      FROM venues v CROSS JOIN generate_series(1, 10) s;

      ANALYZE venues; ANALYZE events;
    `);
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  });

  it("returns every spatial result exactly once across pages", async () => {
    const { ids, distances, pages } = await walk({
      games: ["magic"],
      latitude: 41.8781,
      longitude: -87.6298,
      radiusMiles: 25,
      limit: 100,
    });

    expect(pages).toBeGreaterThan(1);
    expect(ids).toHaveLength(TOTAL_EVENTS);
    expect(new Set(ids).size).toBe(TOTAL_EVENTS);
    // Distance ordering has to hold across the joins between pages, not just
    // within one of them.
    expect(distances).toEqual([...distances].sort((left, right) => left! - right!));
  });

  it("returns every chronological result exactly once across pages", async () => {
    const { ids, pages } = await walk({ games: [], radiusMiles: 50, limit: 100 });

    expect(pages).toBeGreaterThan(1);
    expect(ids).toHaveLength(TOTAL_EVENTS);
    expect(new Set(ids).size).toBe(TOTAL_EVENTS);
  });

  it("carries microsecond precision through the cursor", async () => {
    const first = await listEvents({ games: [], radiusMiles: 50, limit: 10 }, database);
    const decoded = JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString("utf8"));

    // Millisecond precision would land before the real value and repeat rows.
    expect(decoded.startsAt).toMatch(/\.\d{6}Z$/);
  });

  it("ends cleanly on the final page rather than looping", async () => {
    const { pages } = await walk({ games: [], radiusMiles: 50, limit: TOTAL_EVENTS });
    expect(pages).toBe(1);
  });
});
