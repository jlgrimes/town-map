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

  it("covers a 30k US collect in 31 pages, not 300", () => {
    expect(ONEPIECE_PAGE_SIZE).toBe(1000);
    expect(MIN_ONEPIECE_MAX_PAGES).toBe(31);
    expect(DEFAULT_ONEPIECE_MAX_PAGES).toBe(31);
    expect(onePieceMaxEvents({})).toBeGreaterThanOrEqual(US_ONEPIECE_EVENTS);
    expect(MIN_ONEPIECE_MAX_PAGES).toBeLessThan(300);
    expect(onePieceMaxEvents({ ONEPIECE_MAX_PAGES: "10" })).toBeGreaterThanOrEqual(US_ONEPIECE_EVENTS);
  });

  it("still lets ONEPIECE_MAX_PAGES go above the US floor", () => {
    expect(onePieceMaxPages({ ONEPIECE_MAX_PAGES: "50" })).toBe(50);
    expect(onePieceMaxEvents({ ONEPIECE_MAX_PAGES: "50" })).toBe(50_000);
  });
});
