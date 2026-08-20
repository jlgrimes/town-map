import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SEARCH_CENTERS, getSearchCenters } from "./centers.js";

describe("getSearchCenters", () => {
  afterEach(() => {
    delete process.env.RIFTBOUND_SEARCH_CENTERS_JSON;
  });

  it("uses the national catalog even when env pins Chicago", () => {
    process.env.RIFTBOUND_SEARCH_CENTERS_JSON = JSON.stringify([
      { name: "Chicago", latitude: 41.8781, longitude: -87.6298, radiusMiles: 100 },
    ]);
    expect(getSearchCenters().length).toBe(DEFAULT_SEARCH_CENTERS.length);
    expect(getSearchCenters().length).toBeGreaterThan(2);
  });
});
