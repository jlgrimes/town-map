import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ONEPIECE_MAX_PAGES,
  MIN_ONEPIECE_MAX_PAGES,
  ONEPIECE_PAGE_SIZE,
  US_ONEPIECE_EVENTS,
  onePieceMaxEvents,
  onePieceMaxPages,
} from "./pages.js";

describe("ONEPIECE_MAX_PAGES", () => {
  afterEach(() => {
    delete process.env.ONEPIECE_MAX_PAGES;
  });

  it("does not fail a 30k US collect at the old 10k event / 100 page cap", () => {
    expect(ONEPIECE_PAGE_SIZE * 100).toBe(10_000);
    expect(MIN_ONEPIECE_MAX_PAGES).toBeGreaterThan(100);
    expect(DEFAULT_ONEPIECE_MAX_PAGES).toBeGreaterThanOrEqual(MIN_ONEPIECE_MAX_PAGES);
    expect(onePieceMaxEvents({ })).toBeGreaterThanOrEqual(US_ONEPIECE_EVENTS);
    expect(onePieceMaxEvents({ ONEPIECE_MAX_PAGES: "100" })).toBeGreaterThanOrEqual(US_ONEPIECE_EVENTS);
    expect(onePieceMaxPages({ ONEPIECE_MAX_PAGES: "100" })).toBeGreaterThan(100);
  });

  it("still lets ONEPIECE_MAX_PAGES go above the US floor", () => {
    expect(onePieceMaxPages({ ONEPIECE_MAX_PAGES: "500" })).toBe(500);
    expect(onePieceMaxEvents({ ONEPIECE_MAX_PAGES: "500" })).toBe(50_000);
  });
});
