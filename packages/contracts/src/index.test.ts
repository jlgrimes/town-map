import { describe, expect, it } from "vitest";
import {
  CoverageResponseSchema,
  NormalizedEventSchema,
  EventPageSchema,
  EventQuerySchema,
  GameSchema,
  recurrenceLabel,
  SourceSchema,
  UserPreferencesSchema,
  UserPreferencesUpdateSchema,
} from "./index.js";

describe("event API contracts", () => {
  it("requires latitude and longitude together", () => {
    expect(EventQuerySchema.safeParse({ latitude: 41.88 }).success).toBe(false);
    expect(EventQuerySchema.safeParse({ longitude: -87.63 }).success).toBe(false);
    expect(EventQuerySchema.safeParse({ latitude: 41.88, longitude: -87.63 }).success).toBe(true);
  });

  it("accepts One Piece and Riftbound games and sources", () => {
    expect(GameSchema.parse("onepiece")).toBe("onepiece");
    expect(GameSchema.parse("riftbound")).toBe("riftbound");
    expect(SourceSchema.parse("bandai-tcg-plus")).toBe("bandai-tcg-plus");
    expect(SourceSchema.parse("riftbound-locator")).toBe("riftbound-locator");
  });

  it("accepts cursor-paginated event responses", () => {
    expect(EventPageSchema.safeParse({ events: [], count: 0, nextCursor: null }).success).toBe(true);
    expect(EventPageSchema.safeParse({ events: [], count: 0, nextCursor: "opaque" }).success).toBe(true);
  });

  it("accepts coverage freshness responses", () => {
    expect(CoverageResponseSchema.safeParse({
      generatedAt: "2030-01-01T12:00:00.000Z",
      sources: [{
        source: "wotc-locator",
        totalRegions: 1,
        enabledRegions: 1,
        freshRegions: 1,
        pendingRegions: 0,
        staleRegions: 0,
        failingRegions: 0,
        runningRegions: 0,
        upcomingEvents: 12,
        upcomingEventsComputedAt: "2030-01-01T11:00:00.000Z",
        latestSuccessAt: "2030-01-01T11:00:00.000Z",
      }],
      regions: [{
        source: "wotc-locator",
        key: "us-il-chicago",
        label: "Chicago",
        countryCode: "US",
        enabled: true,
        status: "fresh",
        due: false,
        cadenceMinutes: 360,
        nextRunAt: "2030-01-01T17:00:00.000Z",
        lastStartedAt: "2030-01-01T11:00:00.000Z",
        lastSuccessAt: "2030-01-01T11:00:00.000Z",
        lastFailureAt: null,
      }],
    }).success).toBe(true);
  });

  it("validates persisted home addresses", () => {
    expect(UserPreferencesSchema.safeParse({
      homeAddress: "111 N State St, Chicago, IL 60602",
      selectedGames: ["magic", "pokemon"],
      onboardingCompleted: true,
    }).success).toBe(true);
    expect(UserPreferencesSchema.safeParse({
      homeAddress: "",
      selectedGames: [],
      onboardingCompleted: false,
    }).success).toBe(false);
    expect(UserPreferencesUpdateSchema.safeParse({
      homeAddress: "Chicago, IL",
      selectedGames: ["magic"],
    }).success).toBe(true);
    expect(UserPreferencesUpdateSchema.safeParse({
      homeAddress: "Chicago, IL",
      selectedGames: [],
    }).success).toBe(false);
  });
});

describe("recurrenceLabel", () => {
  const series = (cadenceDays: number | null) => ({
    id: "s1", cadenceDays, occurrenceCount: 5, nextStartsAt: null,
  });

  it("names the common intervals", () => {
    expect(recurrenceLabel(series(1))).toBe("Repeats daily");
    expect(recurrenceLabel(series(7))).toBe("Repeats weekly");
    expect(recurrenceLabel(series(14))).toBe("Repeats fortnightly");
  });

  it("treats any month length as monthly", () => {
    for (const days of [28, 30, 31]) {
      expect(recurrenceLabel(series(days))).toBe("Repeats monthly");
    }
  });

  it("falls back to a generic interval", () => {
    expect(recurrenceLabel(series(21))).toBe("Repeats every 3 weeks");
    expect(recurrenceLabel(series(5))).toBe("Repeats every 5 days");
  });

  it("says nothing when the cadence is not established", () => {
    expect(recurrenceLabel(series(null))).toBeNull();
    expect(recurrenceLabel(null)).toBeNull();
  });
});

describe("NormalizedEventSchema", () => {
  function event(overrides: Record<string, unknown> = {}) {
    return {
      sourceEventId: "evt-1",
      game: "magic",
      title: "Friday Night Magic",
      startsAt: "2030-06-01T18:00:00.000Z",
      raw: {},
      ...overrides,
    };
  }

  // PostgreSQL rejects NUL in text and in jsonb, and one of them used to fail
  // every event written in the same batch.
  it("strips NUL from text, from the venue and from the raw payload", () => {
    const nul = String.fromCharCode(0);
    const parsed = NormalizedEventSchema.parse(event({
      title: `Friday${nul} Night`,
      description: `Bring${nul} a deck`,
      venue: { sourceVenueId: "v-1", name: `The${nul} Store` },
      raw: { note: `raw${nul} text`, nested: [`deep${nul} text`] },
    }));

    expect(parsed.title).toBe("Friday Night");
    expect(parsed.description).toBe("Bring a deck");
    expect(parsed.venue?.name).toBe("The Store");
    expect(parsed.raw).toEqual({ note: "raw text", nested: ["deep text"] });
  });

  // Descriptive fields are worth less than the event carrying them, so an
  // unstorable value costs itself rather than the row -- or the batch.
  it.each([
    ["capacity", 2_147_483_648],
    ["capacity", 12.5],
    ["capacity", -1],
    ["priceAmount", 100_000_000],
    ["priceAmount", -5],
  ])("nulls %s when the column could not hold %s", (field, value) => {
    const parsed = NormalizedEventSchema.parse(event({ [field]: value }));
    expect(parsed[field as "capacity" | "priceAmount"]).toBeNull();
  });

  it("keeps values the column can hold", () => {
    const parsed = NormalizedEventSchema.parse(event({ capacity: 64, priceAmount: 12.5 }));
    expect(parsed.capacity).toBe(64);
    expect(parsed.priceAmount).toBe(12.5);
  });

  // What identifies an occurrence stays strict: an event without these is not
  // an event, and storing it would be worse than dropping it.
  it.each([
    ["title", ""],
    ["startsAt", "not-a-timestamp"],
  ])("rejects an event with an unusable %s", (field, value) => {
    expect(NormalizedEventSchema.safeParse(event({ [field]: value })).success).toBe(false);
  });
});
