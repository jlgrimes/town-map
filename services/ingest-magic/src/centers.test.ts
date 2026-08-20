import { describe, expect, it } from "vitest";
import { DEFAULT_SEARCH_CENTERS, parseSearchCenters } from "./centers.js";

describe("DEFAULT_SEARCH_CENTERS", () => {
  it("keeps the region key Chicago's stored events are already filed under", () => {
    const chicago = DEFAULT_SEARCH_CENTERS.find((center) => center.key === "us-il-chicago");
    expect(chicago).toMatchObject({ radiusMeters: 100_000, latitude: 41.8781 });
    expect(chicago?.enabled).not.toBe(false);
  });

  it("enables every region in the catalog", () => {
    expect(DEFAULT_SEARCH_CENTERS.every((center) => center.enabled !== false)).toBe(true);
    expect(DEFAULT_SEARCH_CENTERS.length).toBeGreaterThan(2);
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
  it("accepts a well-formed catalog", () => {
    const valid = JSON.stringify([{ name: "San Francisco", latitude: 37.7749, longitude: -122.4194, radiusMeters: 50000 }]);
    expect(parseSearchCenters(valid)).toEqual([
      { name: "San Francisco", latitude: 37.7749, longitude: -122.4194, radiusMeters: 50_000 },
    ]);
  });

  it("names the field when a radius is missing", () => {
    const configured = JSON.stringify([{ name: "San Francisco", latitude: 37.7749, longitude: -122.4194, radiusMiles: 30 }]);
    expect(() => parseSearchCenters(configured)).toThrow(/radiusMeters must be a finite number/);
  });

  it("rejects an empty array", () => {
    expect(() => parseSearchCenters("[]")).toThrow(/non-empty array/);
  });

  it("rejects a non-array", () => {
    expect(() => parseSearchCenters(JSON.stringify({ name: "San Francisco" }))).toThrow(/non-empty array/);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseSearchCenters("not json")).toThrow(/not valid JSON/);
  });

  it("rejects a missing name", () => {
    expect(() => parseSearchCenters(JSON.stringify([{ latitude: 37.7, longitude: -122.4, radiusMeters: 50000 }]))).toThrow(/name must be a non-empty string/);
  });

  it("rejects a non-numeric latitude", () => {
    expect(() => parseSearchCenters(JSON.stringify([{ name: "X", latitude: "37.7", longitude: -122.4, radiusMeters: 50000 }]))).toThrow(/latitude must be a finite number/);
  });

  it("rejects an out-of-range latitude", () => {
    expect(() => parseSearchCenters(JSON.stringify([{ name: "X", latitude: 91, longitude: -122.4, radiusMeters: 50000 }]))).toThrow(/latitude must be between/);
  });

  it("rejects an out-of-range longitude", () => {
    expect(() => parseSearchCenters(JSON.stringify([{ name: "X", latitude: 37.7, longitude: -181, radiusMeters: 50000 }]))).toThrow(/longitude must be between/);
  });

  it("rejects a zero radius", () => {
    expect(() => parseSearchCenters(JSON.stringify([{ name: "X", latitude: 37.7, longitude: -122.4, radiusMeters: 0 }]))).toThrow(/radiusMeters must be greater than zero/);
  });
});
