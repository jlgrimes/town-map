import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchCenter } from "./centers.js";
import { collectMagicRegion, MAX_PAGES } from "./collect.js";

const center: SearchCenter = {
  key: "us-ca-san-francisco",
  name: "San Francisco",
  latitude: 37.7749,
  longitude: -122.4194,
  radiusMeters: 50_000,
};

function locatorEvent(id: string) {
  return {
    id,
    title: `Friday Night Magic ${id}`,
    // Far enough out to survive the collector's window without being past it.
    scheduledStartTime: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    organization: { id: "store-1", name: "The Game Store" },
  };
}

/** Answers every page from one pool of events, as the locator would. */
function stubLocator(totalResults: number, pageSize = 200) {
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    const { variables } = JSON.parse(init.body) as { variables: { page: number } };
    const start = variables.page * pageSize;
    const events = Array.from(
      { length: Math.max(0, Math.min(pageSize, totalResults - start)) },
      (_, index) => locatorEvent(`evt-${start + index}`),
    );
    return {
      ok: true,
      json: async () => ({ data: { searchEvents: { events, pageInfo: { page: variables.page, pageSize, totalResults } } } }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("collectMagicRegion", () => {
  it("reports a circle it read to the end as complete", async () => {
    const fetchMock = stubLocator(350);

    const result = await collectMagicRegion(center);

    expect(result.complete).toBe(true);
    expect(result.events).toHaveLength(350);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops at a single page when the circle fits in one", async () => {
    const fetchMock = stubLocator(12);

    const result = await collectMagicRegion(center);

    expect(result).toMatchObject({ complete: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  // Withdrawal is a set comparison, so a truncated read that claimed to be
  // complete would retire every event past the ceiling on each run.
  it("reports a circle larger than the page ceiling as incomplete", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = stubLocator(6_000);

    const result = await collectMagicRegion(center);

    expect(result.complete).toBe(false);
    expect(result.events).toHaveLength(MAX_PAGES * 200);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_PAGES);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("San Francisco holds 6000 event(s)"));
    warn.mockRestore();
  });

  it("asks the locator for the circle it was given", async () => {
    const fetchMock = stubLocator(1);

    await collectMagicRegion(center);

    const { variables } = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(variables).toMatchObject({ latitude: 37.7749, longitude: -122.4194, maxMeters: 50_000 });
  });
});
