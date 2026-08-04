import type { NormalizedEvent } from "@town-map/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyRolloutPolicy, runRegionalCollector } from "./index.js";

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
