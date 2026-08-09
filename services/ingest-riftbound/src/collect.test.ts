import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchCenter } from "./centers.js";
import { collectRiftboundRegion, maxPages } from "./collect.js";

const center: SearchCenter = {
  key: "us-ca-san-francisco",
  name: "San Francisco Bay Area",
  latitude: 37.7749,
  longitude: -122.4194,
  radiusMiles: 75,
};

function locatorEvent(id: string) {
  return {
    id,
    name: `Riftbound Weekly ${id}`,
    start_datetime: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    store: { id: "store-1", name: "The Game Store", city: "San Francisco", state: "CA" },
  };
}

/** Answers every page from one pool of events, as the locator would. */
function stubLocator(total: number, pageSize = 250) {
  const fetchMock = vi.fn(async (url: URL) => {
    const page = Number(url.searchParams.get("page"));
    const start = (page - 1) * pageSize;
    const results = Array.from(
      { length: Math.max(0, Math.min(pageSize, total - start)) },
      (_, index) => locatorEvent(`evt-${start + index}`),
    );
    return {
      ok: true,
      json: async () => ({ count: total, next: start + results.length < total ? page + 1 : null, results }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RIFTBOUND_MAX_PAGES;
});

describe("collectRiftboundRegion", () => {
  it("reports a circle it read to the end as complete", async () => {
    const fetchMock = stubLocator(300);

    const result = await collectRiftboundRegion(center);

    expect(result.complete).toBe(true);
    expect(result.events).toHaveLength(300);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops at a single page when the circle fits in one", async () => {
    const fetchMock = stubLocator(9);

    const result = await collectRiftboundRegion(center);

    expect(result).toMatchObject({ complete: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  // Withdrawal is a set comparison, so a truncated read that claimed to be
  // complete would retire every event past the ceiling on each run. Throwing --
  // what this did before -- also discarded the pages it had already read.
  it("keeps what it read and reports a circle past the page ceiling as incomplete", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.RIFTBOUND_MAX_PAGES = "3";
    const fetchMock = stubLocator(6_000);

    const result = await collectRiftboundRegion(center);

    expect(result.complete).toBe(false);
    expect(result.events).toHaveLength(750);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("San Francisco Bay Area holds 6000 event(s)"));
    warn.mockRestore();
  });

  it("asks the locator for the circle it was given, in miles", async () => {
    const fetchMock = stubLocator(1);

    await collectRiftboundRegion(center);

    const url = fetchMock.mock.calls[0][0] as URL;
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      game_slug: "riftbound",
      latitude: "37.7749",
      longitude: "-122.4194",
      num_miles: "75",
      display_status: "upcoming",
    });
  });

  it("rejects a page ceiling that would read nothing", () => {
    process.env.RIFTBOUND_MAX_PAGES = "0";
    expect(() => maxPages()).toThrow(/RIFTBOUND_MAX_PAGES/);
  });
});
