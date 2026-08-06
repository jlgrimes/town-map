import type { NormalizedEvent } from "@town-map/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyRolloutPolicy, normalizeAll, runRegionalCollector } from "./index.js";

const originalDryRun = process.env.DRY_RUN;
const originalDatabaseUrl = process.env.DATABASE_URL;
const rolloutVariables = [
  "COLLECTOR_ENABLED",
  "COLLECTOR_REGION_ALLOWLIST",
  "COLLECTOR_MAX_REGION_PRIORITY",
] as const;
const originalRolloutVariables = Object.fromEntries(
  rolloutVariables.map((name) => [name, process.env[name]]),
) as Record<(typeof rolloutVariables)[number], string | undefined>;

afterEach(() => {
  if (originalDryRun === undefined) delete process.env.DRY_RUN;
  else process.env.DRY_RUN = originalDryRun;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  for (const name of rolloutVariables) {
    const value = originalRolloutVariables[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

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

describe("runRegionalCollector", () => {
  it("runs each enabled definition independently in dry-run mode", async () => {
    process.env.DRY_RUN = "true";
    delete process.env.DATABASE_URL;
    const collect = vi.fn(async (region: { key: string }) => [event(region.key)]);

    const result = await runRegionalCollector("wotc-locator", [
      { key: "one", label: "One", config: { latitude: 1 } },
      { key: "two", label: "Two", config: { latitude: 2 } },
      { key: "disabled", label: "Disabled", enabled: false, config: { latitude: 3 } },
    ], collect);

    expect(collect.mock.calls.map(([region]) => region.key)).toEqual(["one", "two"]);
    expect(result).toEqual({ regionsProcessed: 2, eventsSeen: 2, eventsWritten: 0, dryRun: true });
  });
});

describe("applyRolloutPolicy", () => {
  const definitions = [
    { key: "first", label: "First", priority: 10, config: {} },
    { key: "second", label: "Second", priority: 20, config: {} },
    { key: "third", label: "Third", priority: 30, config: {} },
  ];

  it("supports an emergency stop without removing region definitions", () => {
    process.env.COLLECTOR_ENABLED = "false";
    expect(applyRolloutPolicy(definitions).map((region) => region.enabled)).toEqual([false, false, false]);
  });

  it("combines an allowlist with a priority ceiling", () => {
    process.env.COLLECTOR_REGION_ALLOWLIST = "first,third";
    process.env.COLLECTOR_MAX_REGION_PRIORITY = "20";
    expect(applyRolloutPolicy(definitions).map((region) => region.enabled)).toEqual([true, false, false]);
  });

  it("rejects duplicate region keys", () => {
    expect(() => applyRolloutPolicy([definitions[0], definitions[0]])).toThrow("Duplicate collection region key: first");
  });
});

describe("normalizeAll", () => {
  type Row = { id: string; broken?: boolean };
  const normalize = (row: Row) => {
    if (row.broken) throw new Error("no start time");
    return event(row.id);
  };
  const identify = (row: Row) => row.id;

  // A normalizer reads whatever the source published, so one malformed record
  // used to throw out every record collected alongside it.
  it("drops a record it cannot normalize and keeps the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const events = normalizeAll("wotc-locator", [
      { id: "a" },
      { id: "b", broken: true },
      { id: "c" },
    ], normalize, identify);

    expect(events.map((each) => each.sourceEventId)).toEqual(["a", "c"]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  // Losing most of a batch is a source that changed shape, and collecting
  // nothing quietly is worse than failing the region and keeping what is stored.
  it("fails rather than collecting almost nothing", () => {
    expect(() => normalizeAll("wotc-locator", [
      { id: "a", broken: true },
      { id: "b", broken: true },
      { id: "c" },
    ], normalize, identify)).toThrow(/discarded 2 of 3/);
  });

  it("honours a configured ceiling", () => {
    process.env.COLLECTOR_MAX_SKIPPED_SHARE = "0";
    try {
      expect(() => normalizeAll("wotc-locator", [
        { id: "a", broken: true },
        { id: "b" },
      ], normalize, identify)).toThrow(/discarded 1 of 2/);
    } finally {
      delete process.env.COLLECTOR_MAX_SKIPPED_SHARE;
    }
  });
});

describe("runRegionalCollector validation", () => {
  it("drops an event that is not an event and keeps the batch", async () => {
    process.env.DRY_RUN = "true";
    delete process.env.DATABASE_URL;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await runRegionalCollector("wotc-locator", [
      { key: "one", label: "One", config: {} },
    ], async () => [event("good"), { ...event("bad"), title: "" }]);

    expect(result).toEqual({ regionsProcessed: 1, eventsSeen: 1, eventsWritten: 0, dryRun: true });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
    info.mockRestore();
  });
});
