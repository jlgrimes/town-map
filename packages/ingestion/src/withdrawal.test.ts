import type { NormalizedEvent } from "@town-map/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const claimNextCollectionRegion = vi.fn();
const withdrawMissingEvents = vi.fn(async (..._args: unknown[]) => 0);
const upsertEvents = vi.fn(async (..._args: unknown[]) => ({ written: 1, skipped: 0 }));

vi.mock("@town-map/db", () => ({
  assignEventSeries: vi.fn(async () => {}),
  beginSync: vi.fn(async () => "sync-1"),
  claimNextCollectionRegion: (...args: unknown[]) => claimNextCollectionRegion(...args),
  closePool: vi.fn(async () => {}),
  finishCollectionRegion: vi.fn(async () => {}),
  finishSync: vi.fn(async () => {}),
  refreshSourceEventCount: vi.fn(async () => {}),
  registerCollectionRegions: vi.fn(async () => {}),
  upsertEvents: (...args: unknown[]) => upsertEvents(...args),
  withdrawMissingEvents: (...args: unknown[]) => withdrawMissingEvents(...args),
}));

const { runRegionalCollector } = await import("./index.js");

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalDryRun = process.env.DRY_RUN;

function event(id: string): NormalizedEvent {
  return {
    sourceSeriesId: null,
    sourceEventId: id,
    game: "magic",
    title: `Event ${id}`,
    description: null,
    startsAt: "2030-01-01T12:00:00.000Z",
    endsAt: null,
    timezone: "UTC",
    status: "scheduled",
    format: null,
    eventType: null,
    sourceUrl: `https://example.com/${id}`,
    registrationUrl: null,
    priceAmount: null,
    priceCurrency: null,
    capacity: null,
    isOnline: false,
    venue: null,
    raw: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = "postgresql://localhost:5432/town_map_test";
  process.env.DRY_RUN = "false";
  // One region, claimed once, so the run stops after a single pass.
  claimNextCollectionRegion
    .mockResolvedValueOnce({
      id: "region-1",
      source: "wotc-locator",
      key: "us-ca-san-francisco",
      label: "San Francisco",
      countryCode: "US",
      config: {},
      cadenceMinutes: 360,
    })
    .mockResolvedValue(null);
});

afterEach(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalDryRun === undefined) delete process.env.DRY_RUN;
  else process.env.DRY_RUN = originalDryRun;
});

const definitions = [{ key: "us-ca-san-francisco", label: "San Francisco", config: {} }];

describe("runRegionalCollector withdrawal", () => {
  it("withdraws against a region that returned all of its events", async () => {
    const result = await runRegionalCollector("wotc-locator", definitions, async () => [event("a"), event("b")]);

    expect(withdrawMissingEvents).toHaveBeenCalledWith("region-1", ["a", "b"]);
    expect(result.eventsSeen).toBe(2);
  });

  it("treats a bare array as a complete result", async () => {
    await runRegionalCollector("wotc-locator", definitions, async () => [event("a")]);

    expect(withdrawMissingEvents).toHaveBeenCalledOnce();
  });

  // A collector that stopped at a page ceiling returns a set that looks
  // complete. Withdrawing against it retires the events it never asked for.
  it("stores a partial result without withdrawing anything", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runRegionalCollector(
      "wotc-locator",
      definitions,
      async () => ({ events: [event("a"), event("b")], complete: false }),
    );

    expect(upsertEvents).toHaveBeenCalledOnce();
    expect(withdrawMissingEvents).not.toHaveBeenCalled();
    expect(result.eventsWithdrawn).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("partial result"));
    warn.mockRestore();
  });
});
