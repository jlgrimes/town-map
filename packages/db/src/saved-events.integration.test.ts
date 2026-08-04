import type { NormalizedEvent } from "@town-map/contracts";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrations.js";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = connectionString ? describe : describe.skip;
const schema = `town_map_saved_events_test_${process.pid}`;

let client: Client;
let closePool: typeof import("./index.js").closePool;
let upsertEvents: typeof import("./index.js").upsertEvents;
let listSavedEvents: typeof import("./index.js").listSavedEvents;
let saveEvent: typeof import("./index.js").saveEvent;
let unsaveEvent: typeof import("./index.js").unsaveEvent;

const ALICE = "user_alice";
const BOB = "user_bob";
const FUTURE = "2035-06-01T18:00:00.000Z";
const LATER = "2035-06-08T18:00:00.000Z";
const PAST = "2020-06-01T18:00:00.000Z";
// Well-formed but belonging to no row, which is what a stale client page holds.
const MISSING_EVENT_ID = "00000000-0000-4000-8000-000000000000";

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

async function eventId(sourceEventId: string) {
  const result = await client.query<{ id: string }>(
    "SELECT id FROM events WHERE source_event_id = $1",
    [sourceEventId],
  );
  return result.rows[0].id;
}

async function savedIds(clerkUserId: string) {
  const saved = await listSavedEvents(clerkUserId, client);
  return saved.events.map((item) => item.sourceEventId);
}

integration("saved events", () => {
  beforeAll(async () => {
    client = new Client({ connectionString });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    await applyMigrations(client);

    const url = new URL(connectionString!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    ({ closePool, upsertEvents, listSavedEvents, saveEvent, unsaveEvent } = await import("./index.js"));
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

  it("lists saved events soonest first", async () => {
    await upsertEvents("wotc-locator", [event("b", LATER), event("a", FUTURE)]);
    await saveEvent(ALICE, await eventId("b"), client);
    await saveEvent(ALICE, await eventId("a"), client);

    const saved = await listSavedEvents(ALICE, client);
    expect(saved.events.map((item) => item.sourceEventId)).toEqual(["a", "b"]);
    expect(saved.count).toBe(2);
  });

  // The reason `saveEvent` checks existence and inserts in one statement rather
  // than relying on `ON CONFLICT DO NOTHING` alone.
  it("treats saving the same event twice as one save, not as a failure", async () => {
    await upsertEvents("wotc-locator", [event("a", FUTURE)]);
    const id = await eventId("a");

    await expect(saveEvent(ALICE, id, client)).resolves.toBe(true);
    await expect(saveEvent(ALICE, id, client)).resolves.toBe(true);

    expect(await savedIds(ALICE)).toEqual(["a"]);
  });

  it("reports an unknown event instead of saving it", async () => {
    await expect(saveEvent(ALICE, MISSING_EVENT_ID, client)).resolves.toBe(false);
    expect(await savedIds(ALICE)).toEqual([]);
  });

  it("refuses to save a withdrawn event", async () => {
    await upsertEvents("wotc-locator", [event("a", FUTURE)]);
    await client.query("UPDATE events SET withdrawn_at = now()");

    await expect(saveEvent(ALICE, await eventId("a"), client)).resolves.toBe(false);
  });

  it("removes a save, and removing it again is not an error", async () => {
    await upsertEvents("wotc-locator", [event("a", FUTURE)]);
    const id = await eventId("a");
    await saveEvent(ALICE, id, client);

    await unsaveEvent(ALICE, id, client);
    expect(await savedIds(ALICE)).toEqual([]);

    await expect(unsaveEvent(ALICE, id, client)).resolves.toBeUndefined();
  });

  it("keeps one account's saves out of another's", async () => {
    await upsertEvents("wotc-locator", [event("a", FUTURE), event("b", LATER)]);
    await saveEvent(ALICE, await eventId("a"), client);
    await saveEvent(BOB, await eventId("b"), client);

    expect(await savedIds(ALICE)).toEqual(["a"]);
    expect(await savedIds(BOB)).toEqual(["b"]);
  });

  it("hides an event withdrawn after it was saved", async () => {
    await upsertEvents("wotc-locator", [event("a", FUTURE)]);
    await saveEvent(ALICE, await eventId("a"), client);

    await client.query("UPDATE events SET withdrawn_at = now()");

    expect(await savedIds(ALICE)).toEqual([]);
  });

  it("drops a saved event once it is in the past", async () => {
    await upsertEvents("wotc-locator", [event("old", PAST), event("a", FUTURE)]);
    await saveEvent(ALICE, await eventId("old"), client);
    await saveEvent(ALICE, await eventId("a"), client);

    expect(await savedIds(ALICE)).toEqual(["a"]);
  });

  it("forgets the save when retention deletes the event", async () => {
    await upsertEvents("wotc-locator", [event("a", FUTURE)]);
    await saveEvent(ALICE, await eventId("a"), client);

    await client.query("DELETE FROM events WHERE source_event_id = 'a'");

    expect(await savedIds(ALICE)).toEqual([]);
    const remaining = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM saved_events");
    expect(remaining.rows[0].count).toBe("0");
  });
});
