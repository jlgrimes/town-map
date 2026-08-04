import type { NormalizedEvent } from "@town-map/contracts";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrations.js";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = connectionString ? describe : describe.skip;
const schema = `town_map_series_test_${process.pid}`;

let client: Client;
let closePool: typeof import("./index.js").closePool;
let upsertEvents: typeof import("./index.js").upsertEvents;
let assignEventSeries: typeof import("./index.js").assignEventSeries;

const CHICAGO = "America/Chicago";

function venue(sourceVenueId = "venue-1") {
  return {
    sourceVenueId,
    name: `Store ${sourceVenueId}`,
    address: null,
    city: "Chicago",
    region: "IL",
    postalCode: null,
    country: "US",
    latitude: 41.8781,
    longitude: -87.6298,
    website: null,
    phone: null,
  };
}

function event(id: string, startsAt: string, overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    sourceEventId: id,
    sourceSeriesId: null,
    game: "magic",
    title: "Friday Night Magic",
    description: null,
    startsAt,
    endsAt: null,
    timezone: CHICAGO,
    status: null,
    format: "Modern",
    eventType: null,
    sourceUrl: null,
    registrationUrl: null,
    priceAmount: null,
    priceCurrency: null,
    capacity: null,
    isOnline: false,
    venue: venue(),
    raw: {},
    ...overrides,
  };
}

/** Successive Fridays at 19:00 America/Chicago, expressed in UTC (CDT = -5). */
function fridayEvening(weekOffset: number) {
  const base = Date.UTC(2035, 0, 6, 1, 0, 0); // 2035-01-05 19:00 CDT
  return new Date(base + weekOffset * 7 * 86_400_000).toISOString();
}

async function seriesRows() {
  const result = await client.query<{
    id: string; title: string; format: string | null; weekday: number;
    localStartMinute: number; cadenceDays: number | null; occurrenceCount: number;
  }>(
    // Ordered by every distinguishing column, so comparisons across runs are
    // not at the mercy of physical row order.
    `SELECT id, title, format, weekday, local_start_minute AS "localStartMinute",
       cadence_days AS "cadenceDays", occurrence_count AS "occurrenceCount"
     FROM event_series
     ORDER BY title, format NULLS FIRST, weekday, local_start_minute`,
  );
  return result.rows;
}

async function seriesIdFor(sourceEventId: string) {
  const result = await client.query<{ seriesId: string | null }>(
    `SELECT series_id AS "seriesId" FROM events WHERE source_event_id = $1`,
    [sourceEventId],
  );
  return result.rows[0]?.seriesId ?? null;
}

integration("recurring event series", () => {
  beforeAll(async () => {
    client = new Client({ connectionString });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    await applyMigrations(client);

    const url = new URL(connectionString!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    ({ closePool, upsertEvents, assignEventSeries } = await import("./index.js"));
  }, 60_000);

  beforeEach(async () => {
    await client.query("DELETE FROM events");
    await client.query("DELETE FROM event_series_keys");
    await client.query("DELETE FROM event_series");
  });

  afterAll(async () => {
    await closePool?.();
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  });

  it("groups weekly occurrences into one series", async () => {
    await upsertEvents("wotc-locator", [0, 1, 2, 3].map((week) => event(`fnm-${week}`, fridayEvening(week))));

    await expect(assignEventSeries("wotc-locator")).resolves.toEqual({ assigned: 4 });

    const series = await seriesRows();
    expect(series).toHaveLength(1);
    expect(series[0].occurrenceCount).toBe(4);
    expect(series[0].cadenceDays).toBe(7);
    // Friday, 19:00 local.
    expect(series[0].weekday).toBe(5);
    expect(series[0].localStartMinute).toBe(19 * 60);
  });

  it("is idempotent: a second pass regroups nothing", async () => {
    await upsertEvents("wotc-locator", [0, 1, 2].map((week) => event(`fnm-${week}`, fridayEvening(week))));
    await assignEventSeries("wotc-locator");
    const before = await seriesIdFor("fnm-0");

    await expect(assignEventSeries("wotc-locator")).resolves.toEqual({ assigned: 0 });

    expect(await seriesIdFor("fnm-0")).toBe(before);
    expect(await seriesRows()).toHaveLength(1);
  });

  it("survives daylight saving, which shifts the UTC hour", async () => {
    // Both are 19:00 local: one in CST (UTC-6), one in CDT (UTC-5). Keying on
    // UTC would place them an hour apart and fork the series.
    await upsertEvents("wotc-locator", [
      event("winter", "2035-01-06T01:00:00.000Z"),
      event("summer", "2035-07-07T00:00:00.000Z"),
    ]);

    await assignEventSeries("wotc-locator");

    expect(await seriesIdFor("winter")).toBe(await seriesIdFor("summer"));
    expect(await seriesRows()).toHaveLength(1);
  });

  it("keeps a different weekday, format or venue apart", async () => {
    await upsertEvents("wotc-locator", [
      event("friday", fridayEvening(0)),
      event("saturday", new Date(Date.parse(fridayEvening(0)) + 86_400_000).toISOString()),
      event("other-format", fridayEvening(1), { format: "Commander" }),
      event("other-venue", fridayEvening(2), { venue: venue("venue-2") }),
    ]);

    await assignEventSeries("wotc-locator");

    const ids = await Promise.all(
      ["friday", "saturday", "other-format", "other-venue"].map(seriesIdFor),
    );
    expect(new Set(ids).size).toBe(4);
  });

  it("does not claim a cadence from a single gap", async () => {
    await upsertEvents("wotc-locator", [0, 1].map((week) => event(`fnm-${week}`, fridayEvening(week))));

    await assignEventSeries("wotc-locator");

    const [series] = await seriesRows();
    expect(series.occurrenceCount).toBe(2);
    expect(series.cadenceDays).toBeNull();
  });

  it("absorbs a start time that drifts within the hour, keeping one series", async () => {
    await upsertEvents("wotc-locator", [0, 1, 2].map((week) => event(`fnm-${week}`, fridayEvening(week))));
    await assignEventSeries("wotc-locator");
    const original = await seriesIdFor("fnm-0");

    // The store moves it half an hour earlier.
    const shifted = new Date(Date.parse(fridayEvening(3)) - 30 * 60_000).toISOString();
    await upsertEvents("wotc-locator", [event("fnm-3", shifted)]);
    await assignEventSeries("wotc-locator");

    expect(await seriesIdFor("fnm-3")).toBe(original);
    expect(await seriesRows()).toHaveLength(1);
  });

  it("treats an afternoon and an evening event on the same night as separate", async () => {
    const afternoon = new Date(Date.parse(fridayEvening(0)) - 5 * 3_600_000).toISOString();
    await upsertEvents("wotc-locator", [
      event("evening", fridayEvening(0)),
      event("afternoon", afternoon),
    ]);

    await assignEventSeries("wotc-locator");

    expect(await seriesIdFor("evening")).not.toBe(await seriesIdFor("afternoon"));
  });

  it("prefers the upstream series id where a source publishes one", async () => {
    // Different weekdays and times, but Bandai says they are one series.
    await upsertEvents("bandai-tcg-plus", [
      event("op-1", fridayEvening(0), { game: "onepiece", sourceSeriesId: "series-9" }),
      event("op-2", new Date(Date.parse(fridayEvening(1)) + 3 * 86_400_000).toISOString(),
        { game: "onepiece", sourceSeriesId: "series-9", format: "Standard" }),
    ]);

    await assignEventSeries("bandai-tcg-plus");

    expect(await seriesIdFor("op-1")).toBe(await seriesIdFor("op-2"));
    expect(await seriesRows()).toHaveLength(1);
  });

  it("ignores withdrawn occurrences when describing a series", async () => {
    await upsertEvents("wotc-locator", [0, 1, 2].map((week) => event(`fnm-${week}`, fridayEvening(week))));
    await assignEventSeries("wotc-locator");

    await client.query("UPDATE events SET withdrawn_at = now() WHERE source_event_id = 'fnm-2'");
    await assignEventSeries("wotc-locator");

    const [series] = await seriesRows();
    expect(series.occurrenceCount).toBe(2);
  });

  it("leaves events without a venue unassigned rather than inventing a series", async () => {
    await upsertEvents("wotc-locator", [event("online", fridayEvening(0), { venue: null })]);

    await assignEventSeries("wotc-locator");

    expect(await seriesIdFor("online")).toBeNull();
    expect(await seriesRows()).toHaveLength(0);
  });

  it("can be rebuilt from scratch, because grouping derives only from events", async () => {
    await upsertEvents("wotc-locator", [
      ...[0, 1, 2].map((week) => event(`fnm-${week}`, fridayEvening(week))),
      event("commander", fridayEvening(1), { format: "Commander" }),
    ]);
    await assignEventSeries("wotc-locator");
    const before = await seriesRows();

    // Discarding the series clears every reference by cascade, so a re-run has
    // to reproduce the same grouping. This is the escape hatch if the keying
    // ever needs changing: delete and recompute.
    await client.query("DELETE FROM event_series");
    const orphaned = await client.query<{ count: string }>(
      "SELECT count(*)::text FROM events WHERE series_id IS NOT NULL",
    );
    expect(orphaned.rows[0].count).toBe("0");

    await assignEventSeries("wotc-locator");

    const after = await seriesRows();
    const shape = (rows: typeof after) => rows.map(
      ({ title, format, weekday, localStartMinute, occurrenceCount }) =>
        ({ title, format, weekday, localStartMinute, occurrenceCount }));
    expect(shape(after)).toEqual(shape(before));
  });

  it("forks when two schedules first appear in the same pass", async () => {
    // Reconciliation attaches a drifted key to an *existing* series. When both
    // keys are new in one pass — a backfill spanning a permanent time change —
    // there is nothing yet to attach to, so they fork. Incremental collection
    // does not hit this; a bulk import can.
    await upsertEvents("wotc-locator", [
      event("before-change", fridayEvening(0)),
      event("after-change", new Date(Date.parse(fridayEvening(1)) - 30 * 60_000).toISOString()),
    ]);

    await assignEventSeries("wotc-locator");

    expect(await seriesRows()).toHaveLength(2);
  });

  it("surfaces the series on each event the read API returns", async () => {
    const { listEvents } = await import("./index.js");
    const upcoming = [1, 2, 3, 4].map((week) =>
      event(`fnm-${week}`, new Date(Date.now() + week * 7 * 86_400_000).toISOString()));
    await upsertEvents("wotc-locator", upcoming);
    await assignEventSeries("wotc-locator");

    const page = await listEvents({ games: [], radiusMiles: 50, limit: 50 }, client as never);

    expect(page.events).toHaveLength(4);
    const [first] = page.events;
    expect(first.series).not.toBeNull();
    expect(first.series!.cadenceDays).toBe(7);
    expect(first.series!.occurrenceCount).toBe(4);
    // Every occurrence points at the same series.
    expect(new Set(page.events.map((item) => item.series!.id)).size).toBe(1);
  });

  it("reports no series for an event that belongs to none", async () => {
    const { listEvents } = await import("./index.js");
    await upsertEvents("wotc-locator", [
      event("lonely", new Date(Date.now() + 86_400_000).toISOString(), { venue: null }),
    ]);
    await assignEventSeries("wotc-locator");

    const page = await listEvents({ games: [], radiusMiles: 50, limit: 10 }, client as never);

    expect(page.events[0].series).toBeNull();
  });

  it("records the next upcoming occurrence", async () => {
    const past = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const soon = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const later = new Date(Date.now() + 14 * 86_400_000).toISOString();
    await upsertEvents("wotc-locator", [
      event("past", past), event("soon", soon), event("later", later),
    ]);

    await assignEventSeries("wotc-locator");

    const result = await client.query<{ nextStartsAt: Date }>(
      `SELECT next_starts_at AS "nextStartsAt" FROM event_series LIMIT 1`,
    );
    expect(result.rows[0].nextStartsAt.toISOString()).toBe(soon);
  });
});
