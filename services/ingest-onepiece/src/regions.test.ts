import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_REGIONS, getRegions } from "./regions.js";

describe("DEFAULT_REGIONS", () => {
  it("collects the United States, not Illinois-only", () => {
    expect(DEFAULT_REGIONS.length).toBeGreaterThan(0);
    expect(DEFAULT_REGIONS.some((region) => region.countryCode === "US")).toBe(true);
    expect(DEFAULT_REGIONS.every((region) => region.enabled !== false)).toBe(true);
    expect(
      DEFAULT_REGIONS.every(
        (region) => JSON.stringify(region.prefCodes ?? []) !== JSON.stringify(["US-IL"]),
      ),
    ).toBe(true);
    expect(DEFAULT_REGIONS.some((region) => /Illinois/i.test(region.name))).toBe(false);
  });

  it("does not filter Bandai to a single state", () => {
    for (const region of DEFAULT_REGIONS) {
      expect(region.prefCodes ?? []).toHaveLength(0);
    }
  });
});

describe("getRegions", () => {
  afterEach(() => {
    delete process.env.ONEPIECE_REGIONS_JSON;
  });

  it("uses the national catalog even when ONEPIECE_REGIONS_JSON pins Illinois", () => {
    process.env.ONEPIECE_REGIONS_JSON = JSON.stringify([
      { name: "United States — IL", countryCode: "US", prefCodes: ["US-IL"] },
    ]);
    expect(getRegions()).toEqual(DEFAULT_REGIONS);
    expect(getRegions().some((region) => region.countryCode === "US")).toBe(true);
    expect(
      getRegions().every(
        (region) => JSON.stringify(region.prefCodes ?? []) !== JSON.stringify(["US-IL"]),
      ),
    ).toBe(true);
  });

  it("fails if One Piece is still Illinois-only", () => {
    process.env.ONEPIECE_REGIONS_JSON = JSON.stringify([
      { name: "United States — IL", countryCode: "US", prefCodes: ["US-IL"] },
    ]);
    const regions = getRegions();
    const illinoisOnly =
      regions.length === 1 && JSON.stringify(regions[0]?.prefCodes) === JSON.stringify(["US-IL"]);
    expect(illinoisOnly).toBe(false);
  });
});
