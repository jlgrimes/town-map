import { describe, expect, it } from "vitest";
import { DEFAULT_SEARCH_CENTERS, parseSearchCenters } from "./centers.js";

describe("DEFAULT_SEARCH_CENTERS", () => {
  it("keeps the region key Chicago's stored events are already filed under", () => {
    const chicago = DEFAULT_SEARCH_CENTERS.find((center) => center.key === "us-il-chicago");
    expect(chicago).toMatchObject({ radiusMeters: 100_000, latitude: 41.8781 });
    expect(chicago?.enabled).not.toBe(false);
  });

  it("registers the catalog beyond the measured cohort as disabled", () => {
    const enabled = DEFAULT_SEARCH_CENTERS.filter((center) => center.enabled !== false);
    expect(enabled.map((center) => center.key)).toEqual(["us-il-chicago", "us-ca-san-francisco"]);
  });

  it("gives every center a unique key and a usable circle", () => {
    const keys = DEFAULT_SEARCH_CENTERS.map((center) => center.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const center of DEFAULT_SEARCH_CENTERS) {
      expect(center.key).toMatch(/^[a-z0-9-]+$/);
      expect(Math.abs(center.latitude)).toBeLessThanOrEqual(90);
      expect(Math.abs(center.longitude)).toBeLessThanOrEqual(180);
      expect(center.radiusMeters).toBeGreaterThan(0);
    }
  });
});

describe("parseSearchCenters", () => {
  const valid = '[{"name":"San Francisco","latitude":37.7749,"longitude":-122.4194,"radiusMeters":50000}]';

  it("accepts a well-formed catalog", () => {
    expect(parseSearchCenters(valid)).toEqual([
      { name: "San Francisco", latitude: 37.7749, longitude: -122.4194, radiusMeters: 50_000 },
    ]);
  });

  // The Riftbound collector's centers use radiusMiles, and copying that shape
  // sent maxMeters: undefined -- a region that failed every run and read as a
  // city with no events.
  it("names the field when a radius is missing", () => {
    const configured = '[{"name":"San Francisco","latitude":37.7749,"longitude":-122.4194,"radiusMiles":30}]';
    expect(() => parseSearchCenters(configured)).toThrow(/radiusMeters must be a finite number/);
  });

  it.each([
    ["[]", /non-empty array/],
    ['{"name":"San Francisco"}', /non-empty array/],
    ["not json", /not valid JSON/],
    ['[{"latitude":37.7,"longitude":-122.4,"radiusMeters":50000}]', /name must be a non-empty string/],
    ['[{"name":"X","latitude":"37.7","longitude":-122.4,"radiusMeters":50000}]', /latitude must be a finite number/],
    ['[{"name":"X","latitude":91,"longitude":-122.4,"radiusMeters":50000}]', /latitude must be between/],
    ['[{"name":"X","latitude":37.7,"longitude":-181,"radiusMeters":50000}]', /longitude must be between/],
    ['[{"name":"X","latitude":37.7,"longitude":-122.4,"radiusMeters":0}]', /radiusMeters must be greater than zero/],
  ])("rejects %s", (configured, message) => {
    expect(() => parseSearchCenters(configured)).toThrow(message);
  });
});
