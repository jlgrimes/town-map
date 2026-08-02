import { describe, expect, it } from "vitest";
import { CoverageResponseSchema, EventPageSchema, EventQuerySchema, GameSchema, SourceSchema, UserPreferencesSchema, UserPreferencesUpdateSchema } from "./index.js";

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
