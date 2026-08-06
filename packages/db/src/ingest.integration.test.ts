import type { NormalizedEvent } from "@town-map/contracts";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrations.js";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = connectionString ? describe : describe.skip;
const schema = `town_map_ingest_test_${process.pid}`;

let client: Client;
let closePool: typeof import("./index.js").closePool;
let upsertEvents: typeof import("./index.js").upsertEvents;
let refreshSourceEventCount: typeof import("./index.js").refreshSourceEventCount;

function event(index: number, overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    sourceEventId: `event-${index}`,
    sourceSeriesId: null,
    game: "magic",
    title: `Event ${index}`,
    description: null,
    startsAt: "2030-06-01T18:00:00.000Z",
    endsAt: null,
    timezone: "America/Chicago",
    status: "scheduled",
    format: "Commander",
    eventType: null,
    sourceUrl: `https://example.com/events/${index}`,
    registrationUrl: null,
    priceAmount: 5,
    priceCurrency: "USD",
    capacity: 24,
    isOnline: false,
    venue: {
      sourceVenueId: "venue-1",
      name: "Chicago Center",
      address: "111 N State St",
      city: "Chicago",
      region: "IL",
      postalCode: "60601",
      country: "US",
      latitude: 41.8781,
      longitude: -87.6298,
      website: null,
      phone: null,
    },
    raw: { index },
    ...overrides,
  };
}

async function rowVersions() {
  const result = await client.query<{ sourceEventId: string; version: string }>(
    `SELECT source_event_id AS "sourceEventId", xmin::text AS version
     FROM events ORDER BY source_event_id`,
  );
  return new Map(result.rows.map((row) => [row.sourceEventId, row.version]));
}

integration("collector writes", () => {
  beforeAll(async () => {
    client = new Client({ connectionString });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    await applyMigrations(client);

    // upsertEvents uses the module-level pool, so point it at the same schema.
    const url = new URL(connectionString!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    ({ closePool, upsertEvents, refreshSourceEventCount } = await import("./index.js"));
  }, 60_000);

  afterAll(async () => {
    await closePool?.();
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  });

  it("writes one venue for many events sharing it and denormalises its coordinates", async () => {
    const events = [event(1), event(2), event(3)];

    await expect(upsertEvents("wotc-locator", events)).resolves.toEqual({ written: 3, skipped: 0 });

    const venues = await client.query<{ count: string }>("SELECT count(*)::text FROM venues");
    expect(venues.rows[0].count).toBe("1");

    const stored = await client.query<{ latitude: number; longitude: number; venueId: string }>(
      `SELECT latitude, longitude, venue_id AS "venueId" FROM events ORDER BY source_event_id`,
    );
    expect(stored.rows).toHaveLength(3);
    expect(stored.rows.every((row) => row.latitude === 41.8781 && row.longitude === -87.6298)).toBe(true);
    expect(new Set(stored.rows.map((row) => row.venueId)).size).toBe(1);
  });

  it("leaves unchanged rows untouched on a repeat sync", async () => {
    const before = await rowVersions();

    await upsertEvents("wotc-locator", [event(1), event(2), event(3)]);

    expect(await rowVersions()).toEqual(before);
  });

  it("rewrites only the events whose content actually changed", async () => {
    const before = await rowVersions();

    await upsertEvents("wotc-locator", [
      event(1),
      event(2, { title: "Renamed Event 2" }),
      event(3),
    ]);

    const after = await rowVersions();
    expect(after.get("event-1")).toBe(before.get("event-1"));
    expect(after.get("event-3")).toBe(before.get("event-3"));
    expect(after.get("event-2")).not.toBe(before.get("event-2"));

    const renamed = await client.query<{ title: string }>(
      "SELECT title FROM events WHERE source_event_id = 'event-2'",
    );
    expect(renamed.rows[0].title).toBe("Renamed Event 2");
  });

  it("collapses duplicate source event ids within one batch, keeping the last", async () => {
    await expect(upsertEvents("wotc-locator", [
      event(9, { title: "First" }),
      event(9, { title: "Last" }),
    ])).resolves.toEqual({ written: 1, skipped: 0 });

    const stored = await client.query<{ title: string }>(
      "SELECT title FROM events WHERE source_event_id = 'event-9'",
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].title).toBe("Last");
  });

  it("propagates a venue coordinate correction onto its events", async () => {
    const moved = { ...event(1).venue!, latitude: 41.9, longitude: -87.7 };
    await upsertEvents("wotc-locator", [event(1, { venue: moved })]);

    const stored = await client.query<{ latitude: number; longitude: number }>(
      "SELECT latitude, longitude FROM events WHERE source_event_id = 'event-1'",
    );
    expect(stored.rows[0]).toEqual({ latitude: 41.9, longitude: -87.7 });
  });

  it("stores events that have no venue", async () => {
    await expect(upsertEvents("wotc-locator", [event(20, { venue: null })]))
      .resolves.toEqual({ written: 1, skipped: 0 });

    const stored = await client.query<{ venueId: string | null; latitude: number | null }>(
      `SELECT venue_id AS "venueId", latitude FROM events WHERE source_event_id = 'event-20'`,
    );
    expect(stored.rows[0]).toEqual({ venueId: null, latitude: null });
  });

  it("snapshots only upcoming events for the requested source", async () => {
    await upsertEvents("wotc-locator", [
      event(40, { startsAt: "2030-06-01T18:00:00.000Z" }),
      event(41, { startsAt: "2020-06-01T18:00:00.000Z" }),
    ]);
    await upsertEvents("konami-kcgn", [event(42, { game: "yugioh" })]);

    await refreshSourceEventCount("wotc-locator", client);

    const snapshot = await client.query<{ source: string; upcomingEvents: number; computedAt: Date }>(
      `SELECT source, upcoming_events AS "upcomingEvents", computed_at AS "computedAt"
       FROM source_event_counts ORDER BY source`,
    );
    // Only the refreshed source is recorded, and the past event is excluded.
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0].source).toBe("wotc-locator");
    expect(snapshot.rows[0].computedAt).toBeInstanceOf(Date);

    const upcoming = await client.query<{ count: string }>(
      "SELECT count(*)::text FROM events WHERE source = 'wotc-locator' AND starts_at >= now()",
    );
    expect(snapshot.rows[0].upcomingEvents).toBe(Number(upcoming.rows[0].count));
  });

  it("overwrites an existing snapshot rather than duplicating it", async () => {
    await refreshSourceEventCount("wotc-locator", client);
    const first = await client.query<{ computedAt: Date }>(
      `SELECT computed_at AS "computedAt" FROM source_event_counts WHERE source = 'wotc-locator'`,
    );

    await upsertEvents("wotc-locator", [event(43)]);
    await refreshSourceEventCount("wotc-locator", client);

    const after = await client.query<{ count: string; upcomingEvents: number; computedAt: Date }>(
      `SELECT count(*) OVER ()::text AS count, upcoming_events AS "upcomingEvents",
              computed_at AS "computedAt"
       FROM source_event_counts WHERE source = 'wotc-locator'`,
    );
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].computedAt.getTime()).toBeGreaterThanOrEqual(first.rows[0].computedAt.getTime());
  });

  // A region is written in one transaction, so a row PostgreSQL rejects used to
  // discard every event collected alongside it -- and did so again on every run,
  // for as long as the source kept publishing it.
  it("skips a row PostgreSQL rejects and writes the rest of the batch", async () => {
    await expect(upsertEvents("wotc-locator", [
      event(30),
      event(31, { startsAt: "not-a-timestamp" }),
      event(32),
    ])).resolves.toEqual({ written: 2, skipped: 1 });

    const stored = await client.query<{ sourceEventId: string }>(
      `SELECT source_event_id AS "sourceEventId" FROM events
       WHERE source_event_id = ANY($1::text[]) ORDER BY source_event_id`,
      [["event-30", "event-31", "event-32"]],
    );
    expect(stored.rows.map((row) => row.sourceEventId)).toEqual(["event-30", "event-32"]);
  });

  it("keeps a venue it cannot write from costing the events that reference it", async () => {
    // NUL is rejected by `text`, and reaches a venue website the same way it
    // reaches any other free-text field. `NormalizedEventSchema` strips it
    // before a collector gets here; this is what happens if anything ever
    // slips past that. Deliberately a field the event does not copy: the venue
    // name is denormalised into `search_text`, so a bad character there is the
    // event's problem too, not only the venue's.
    const unwritable = {
      ...event(33).venue!,
      sourceVenueId: "venue-unwritable",
      website: `https://example.com/${String.fromCharCode(0)}`,
    };

    await expect(upsertEvents("wotc-locator", [event(33, { venue: unwritable })]))
      .resolves.toEqual({ written: 1, skipped: 0 });

    const stored = await client.query<{ venueId: string | null }>(
      `SELECT venue_id AS "venueId" FROM events WHERE source_event_id = $1`,
      ["event-33"],
    );
    expect(stored.rows[0].venueId).toBeNull();
  });
});
