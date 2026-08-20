import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SEARCH_CENTERS, getSearchCenters } from "./centers.js";

function regionStates(centers: Array<{ key?: string }>) {
  return [...new Set(
    centers
      .map((center) => center.key?.match(/^us-([a-z]{2})-/)?.[1])
      .filter((code): code is string => Boolean(code)),
  )];
}

describe("Riftbound catalog", () => {
  afterEach(() => {
    delete process.env.RIFTBOUND_SEARCH_CENTERS_JSON;
  });

  it("fails if Riftbound is still one region", () => {
    const states = regionStates(DEFAULT_SEARCH_CENTERS);
    expect(states.length).toBeGreaterThan(1);
    expect(states).toContain("ca");
    expect(states).toContain("ny");
    expect(states).toContain("tx");
    expect(states).not.toEqual(["il"]);
  });

  it("is national, not Chicago-only", () => {
    expect(DEFAULT_SEARCH_CENTERS.length).toBeGreaterThan(2);
    expect(DEFAULT_SEARCH_CENTERS.some((center) => center.key === "us-il-chicago")).toBe(true);
    expect(DEFAULT_SEARCH_CENTERS.some((center) => center.key === "us-ny-new-york")).toBe(true);
    expect(DEFAULT_SEARCH_CENTERS.some((center) => center.key === "us-tx-el-paso")).toBe(true);
  });

  it("ignores a leftover one-circle Illinois env catalog", () => {
    process.env.RIFTBOUND_SEARCH_CENTERS_JSON = JSON.stringify([
      { name: "Chicago", latitude: 41.8781, longitude: -87.6298, radiusMiles: 100 },
    ]);
    const states = regionStates(getSearchCenters());
    expect(states.length).toBeGreaterThan(1);
    expect(getSearchCenters()).toHaveLength(DEFAULT_SEARCH_CENTERS.length);
  });
});
