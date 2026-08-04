import type { NormalizedEvent } from "@town-map/contracts";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrations.js";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = connectionString ? describe : describe.skip;
const schema = `town_map_withdrawal_test_${process.pid}`;

let client: Client;
let closePool: typeof import("./index.js").closePool;
let upsertEvents: typeof import("./index.js").upsertEvents;
let withdrawMissingEvents: typeof import("./index.js").withdrawMissingEvents;
let listEvents: typeof import("./index.js").listEvents;

let regionA: string;
let regionB: string;

function event(id: string, startsAt: string): NormalizedEvent {
  return {
    sourceEventId: id,
    sourceSeriesId: null,
    game: "magic",
    title: `Event ${id}`,
    description: null,
    startsAt,
    endsAt: null,
    timezone: "America/Chicago",
    status: "scheduled",
    format: null,
    eventType: null,
    sourceUrl: null,
    registrationUrl: null,
    priceAmount: null,
    priceCurrency: null,
    capacity: null,
    isOnline: false,
    venue: {
      sourceVenueId: "venue-1",
      name: "Chicago Center",
      address: null,
      city: "Chicago",
      region: "IL",
      postalCode: null,
      country: "US",
      latitude: 41.8781,
      longitude: -87.6298,
      website: null,
      phone: null,
    },
    raw: {},
  };
}

const FUTURE = "2035-06-01T18:00:00.000Z";
const PAST = "2020-06-01T18:00:00.000Z";

async function withdrawnIds() {
  const result = await client.query<{ sourceEventId: string }>(
    `SELECT source_event_id AS "sourceEventId" FROM events
     WHERE withdrawn_at IS NOT NULL ORDER BY source_event_id`,
  );
  return result.rows.map((row) => row.sourceEventId);
}

integration("withdrawing events that disappear upstream", () => {
  beforeAll(async () => {
    client = new Client({ connectionString });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    await applyMigrations(client);

    const url = new URL(connectionString!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    ({ closePool, upsertEvents, withdrawMissingEvents, listEvents } = await import("./index.js"));

    const regions = await client.query<{ id: string }>(
      `INSERT INTO collection_regions (source, region_key, label)
       VALUES ('wotc-locator', 'region-a', 'Region A'), ('wotc-locator', 'region-b', 'Region B')
       RETURNING id`,
    );
    [regionA, regionB] = regions.rows.map((row) => row.id);
  }, 60_000);

  beforeEach(async () => {
    await client.query("DELETE FROM events");
  });

  afterAll(async () => {
    await closePool?.();
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  });

  it("withdraws an upcoming event the region no longer returns", async () => {
    await upsertEvents("wotc-locator", [event("a", FUTURE), event("b", FUTURE)], {
      collectionRegionId: regionA,
    });

    await expect(withdrawMissingEvents(regionA, ["a"], client)).resolves.toBe(1);

    expect(await withdrawnIds()).toEqual(["b"]);
  });

  it("keeps withdrawn events out of the read API without deleting them", async () => {
    await upsertEvents("wotc-locator", [event("a", FUTURE), event("b", FUTURE)], {
      collectionRegionId: regionA,
    });
    await withdrawMissingEvents(regionA, ["a"], client);

    const page = await listEvents({ games: [], radiusMiles: 50, limit: 50 }, client as never);
    expect(page.events.map((item) => item.sourceEventId)).toEqual(["a"]);

    const retained = await client.query<{ count: string }>("SELECT count(*)::text FROM events");
    expect(retained.rows[0].count).toBe("2");
  });

  it("restores an event that reappears in a later run", async () => {
    await upsertEvents("wotc-locator", [event("a", FUTURE)], { collectionRegionId: regionA });
    await withdrawMissingEvents(regionA, ["placeholder"], client);
    expect(await withdrawnIds()).toEqual(["a"]);

    await upsertEvents("wotc-locator", [event("a", FUTURE)], { collectionRegionId: regionA });

    expect(await withdrawnIds()).toEqual([]);
    const page = await listEvents({ games: [], radiusMiles: 50, limit: 50 }, client as never);
    expect(page.events.map((item) => item.sourceEventId)).toEqual(["a"]);
  });

  it("leaves past events alone, since upstream feeds drop them legitimately", async () => {
    await upsertEvents("wotc-locator", [event("old", PAST), event("new", FUTURE)], {
      collectionRegionId: regionA,
    });

    await withdrawMissingEvents(regionA, ["unrelated"], client);

    expect(await withdrawnIds()).toEqual(["new"]);
  });

  it("never withdraws events belonging to another region", async () => {
    await upsertEvents("wotc-locator", [event("a", FUTURE)], { collectionRegionId: regionA });
    await upsertEvents("wotc-locator", [event("b", FUTURE)], { collectionRegionId: regionB });

    await withdrawMissingEvents(regionA, ["unrelated"], client);

    expect(await withdrawnIds()).toEqual(["a"]);
  });

  it("refuses to act on an empty result rather than emptying the region", async () => {
    await upsertEvents("wotc-locator", [event("a", FUTURE), event("b", FUTURE)], {
      collectionRegionId: regionA,
    });

    await expect(withdrawMissingEvents(regionA, [], client)).resolves.toBe(0);

    expect(await withdrawnIds()).toEqual([]);
  });

  it("is idempotent across repeated sweeps", async () => {
    await upsertEvents("wotc-locator", [event("a", FUTURE), event("b", FUTURE)], {
      collectionRegionId: regionA,
    });

    await expect(withdrawMissingEvents(regionA, ["a"], client)).resolves.toBe(1);
    await expect(withdrawMissingEvents(regionA, ["a"], client)).resolves.toBe(0);
  });

  it("excludes withdrawn events from the source snapshot", async () => {
    const { refreshSourceEventCount } = await import("./index.js");
    await upsertEvents("wotc-locator", [event("a", FUTURE), event("b", FUTURE)], {
      collectionRegionId: regionA,
    });
    await withdrawMissingEvents(regionA, ["a"], client);

    await refreshSourceEventCount("wotc-locator", client);

    const snapshot = await client.query<{ upcomingEvents: number }>(
      `SELECT upcoming_events AS "upcomingEvents" FROM source_event_counts WHERE source = 'wotc-locator'`,
    );
    expect(snapshot.rows[0].upcomingEvents).toBe(1);
  });
});
