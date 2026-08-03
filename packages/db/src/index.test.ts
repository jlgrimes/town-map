import type { EventQuery } from "@town-map/contracts";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { getUserPreferences, InvalidEventCursorError, listCoverage, listEvents, saveUserPreferences } from "./index.js";

const ids = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
];

function row(index: number, distanceMeters: number | null) {
  return {
    id: ids[index],
    source: "wotc-locator" as const,
    sourceEventId: `source-${index}`,
    game: "magic" as const,
    title: `Event ${index}`,
    description: null,
    startsAt: new Date(`2030-01-0${index + 1}T18:00:00.000Z`),
    endsAt: null,
    timezone: "America/Chicago",
    status: "scheduled",
    format: "Commander",
    eventType: null,
    sourceUrl: `https://example.com/events/${index}`,
    registrationUrl: null,
    priceAmount: "5.00",
    priceCurrency: "USD",
    capacity: 24,
    isOnline: false,
    distanceMeters,
    venueName: `Venue ${index}`,
    venueAddress: `${index} Main St`,
    venueCity: "Chicago",
    venueRegion: "IL",
    venuePostalCode: "60601",
    venueLatitude: 41.88,
    venueLongitude: -87.63,
    venueWebsite: null,
  };
}

function databaseReturning(rows: ReturnType<typeof row>[]) {
  const query = vi.fn().mockResolvedValue({ rows });
  return { database: { query } as unknown as Pick<Pool, "query">, query };
}

const spatialQuery: EventQuery = {
  games: ["magic"],
  latitude: 41.8781,
  longitude: -87.6298,
  radiusMiles: 25,
  limit: 2,
};

describe("listEvents", () => {
  it("filters and orders spatial results in PostGIS before applying the page limit", async () => {
    const { database, query } = databaseReturning([row(0, 1609.344), row(1, 3218.688), row(2, 4828.032)]);

    const page = await listEvents(spatialQuery, database);

    expect(page.events).toHaveLength(2);
    expect(page.events.map((event) => event.distanceMiles)).toEqual([1, 2]);
    expect(page.nextCursor).toBeTypeOf("string");
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("e.latitude BETWEEN");
    expect(sql).toContain("e.longitude BETWEEN");
    expect(sql).not.toContain("JOIN venues v ON v.id = e.venue_id");
    expect(sql).toContain("asin(sqrt");
    expect(sql).toContain('WHERE "distanceMeters" <=');
    expect(sql).toContain('ORDER BY "distanceMeters" ASC, "startsAt" ASC, id ASC');
    expect(sql.indexOf('"distanceMeters" <=')).toBeLessThan(sql.indexOf("LIMIT"));
    expect(values).toContain(25 * 1609.344);
    expect(values.at(-1)).toBe(3);
  });

  it("uses an opaque spatial cursor for a stable next page", async () => {
    const firstDatabase = databaseReturning([row(0, 100), row(1, 200), row(2, 300)]);
    const firstPage = await listEvents(spatialQuery, firstDatabase.database);
    const secondDatabase = databaseReturning([row(2, 300)]);

    const secondPage = await listEvents({ ...spatialQuery, cursor: firstPage.nextCursor! }, secondDatabase.database);

    expect(secondPage.events.map((event) => event.id)).toEqual([ids[2]]);
    expect(secondPage.nextCursor).toBeNull();
    const [sql, values] = secondDatabase.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('("distanceMeters", "startsAt", id) >');
    expect(values).toContain(200);
    expect(values).toContain(ids[1]);
  });

  it("uses chronological keyset pagination when no location is supplied", async () => {
    const { database, query } = databaseReturning([row(0, null), row(1, null)]);

    const page = await listEvents({ games: [], radiusMiles: 50, limit: 1 }, database);

    expect(page.events).toHaveLength(1);
    expect(page.events[0].distanceMiles).toBeNull();
    expect(page.nextCursor).toBeTypeOf("string");
    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain("ST_DWithin");
    expect(sql).toContain("ORDER BY e.starts_at ASC, e.id ASC");
  });

  it("rejects malformed or cross-mode cursors before querying PostgreSQL", async () => {
    const { database, query } = databaseReturning([]);

    await expect(listEvents({ ...spatialQuery, cursor: "not-a-cursor" }, database)).rejects.toBeInstanceOf(InvalidEventCursorError);
    expect(query).not.toHaveBeenCalled();

    const chronologicalDatabase = databaseReturning([row(0, null), row(1, null)]);
    const chronologicalPage = await listEvents({ games: [], radiusMiles: 50, limit: 1 }, chronologicalDatabase.database);
    await expect(listEvents({ ...spatialQuery, cursor: chronologicalPage.nextCursor! }, database)).rejects.toBeInstanceOf(InvalidEventCursorError);
    await expect(listEvents({ ...spatialQuery, radiusMiles: 50, cursor: firstSpatialCursor() }, database)).rejects.toBeInstanceOf(InvalidEventCursorError);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("listCoverage", () => {
  it("reports region freshness and source event totals without exposing collector config", async () => {
    const now = Date.now();
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [
        {
          source: "wotc-locator",
          regionKey: "fresh",
          label: "Fresh",
          countryCode: "US",
          enabled: true,
          cadenceMinutes: 360,
          nextRunAt: new Date(now + 60_000),
          leaseExpiresAt: null,
          lastStartedAt: new Date(now - 3_600_000),
          lastSuccessAt: new Date(now - 3_600_000),
          lastFailureAt: null,
        },
        {
          source: "wotc-locator",
          regionKey: "failing",
          label: "Failing",
          countryCode: "CA",
          enabled: true,
          cadenceMinutes: 360,
          nextRunAt: new Date(now - 60_000),
          leaseExpiresAt: null,
          lastStartedAt: new Date(now - 30_000),
          lastSuccessAt: new Date(now - 3_600_000),
          lastFailureAt: new Date(now - 30_000),
        },
        {
          source: "wotc-locator",
          regionKey: "disabled",
          label: "Disabled",
          countryCode: null,
          enabled: false,
          cadenceMinutes: 360,
          nextRunAt: new Date(now - 60_000),
          leaseExpiresAt: null,
          lastStartedAt: null,
          lastSuccessAt: null,
          lastFailureAt: null,
        },
      ] })
      .mockResolvedValueOnce({ rows: [{
        source: "wotc-locator",
        upcomingEvents: 42,
        computedAt: new Date("2026-08-03T10:00:00.000Z"),
      }] });

    const result = await listCoverage({ query } as never);

    // Read from the snapshot table, never counted per request.
    expect(query.mock.calls[1][0]).toContain("FROM source_event_counts");
    expect(query.mock.calls.every(([sql]) => !/count\(\*\)[\s\S]*FROM events/.test(sql))).toBe(true);

    expect(result.regions.map((region) => [region.key, region.status, region.due])).toEqual([
      ["fresh", "fresh", false],
      ["failing", "failing", true],
      ["disabled", "disabled", false],
    ]);
    expect(result.sources).toEqual([expect.objectContaining({
      source: "wotc-locator",
      totalRegions: 3,
      enabledRegions: 2,
      freshRegions: 1,
      failingRegions: 1,
      upcomingEvents: 42,
      upcomingEventsComputedAt: "2026-08-03T10:00:00.000Z",
    })]);
    expect(JSON.stringify(result)).not.toContain("config");
  });

  it("distinguishes a source with no snapshot yet from one counted at zero", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{
        source: "konami-kcgn",
        regionKey: "US:IL",
        label: "Illinois",
        countryCode: "US",
        enabled: true,
        cadenceMinutes: 360,
        nextRunAt: new Date(),
        leaseExpiresAt: null,
        lastStartedAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
      }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await listCoverage({ query } as never);

    expect(result.sources).toEqual([expect.objectContaining({
      source: "konami-kcgn",
      upcomingEvents: 0,
      upcomingEventsComputedAt: null,
    })]);
  });
});

describe("user preferences", () => {
  it("returns an empty preference object for a new Clerk user", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(getUserPreferences("user_new", { query } as never)).resolves.toEqual({
      homeAddress: null,
      selectedGames: [],
      onboardingCompleted: false,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE clerk_user_id = $1"), ["user_new"]);
  });

  it("upserts and returns completed onboarding preferences", async () => {
    const homeAddress = "111 N State St, Chicago, IL 60602";
    const selectedGames = ["magic", "pokemon"] as const;
    const query = vi.fn().mockResolvedValue({ rows: [{
      homeAddress,
      selectedGames: [...selectedGames],
      onboardingCompletedAt: new Date("2026-08-02T12:00:00.000Z"),
    }] });

    await expect(saveUserPreferences("user_123", homeAddress, [...selectedGames], { query } as never)).resolves.toEqual({
      homeAddress,
      selectedGames: [...selectedGames],
      onboardingCompleted: true,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT (clerk_user_id)"), [
      "user_123", homeAddress, [...selectedGames],
    ]);
  });
});

function firstSpatialCursor() {
  return Buffer.from(JSON.stringify({
    version: 1,
    kind: "spatial",
    scope: JSON.stringify({
      games: ["magic"],
      to: null,
      latitude: 41.8781,
      longitude: -87.6298,
      radiusMiles: 25,
    }),
    snapshotFrom: "2026-01-01T00:00:00.000Z",
    startsAt: "2030-01-01T18:00:00.000Z",
    id: ids[0],
    distanceMeters: 100,
  })).toString("base64url");
}
