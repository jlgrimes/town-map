import type { NormalizedEvent } from "@town-map/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runRegionalCollector } from "./index.js";

const originalDryRun = process.env.DRY_RUN;
const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalDryRun === undefined) delete process.env.DRY_RUN;
  else process.env.DRY_RUN = originalDryRun;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

function event(id: string): NormalizedEvent {
  return {
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
