import { describe, expect, it } from "vitest";
import { DEFAULT_ONEPIECE_MAX_PAGES, DEFAULT_ONEPIECE_PAGE_SIZE } from "./paging.js";

describe("One Piece Bandai paging", () => {
  it("covers a 30k US catalog in one collect", () => {
    expect(DEFAULT_ONEPIECE_PAGE_SIZE * DEFAULT_ONEPIECE_MAX_PAGES).toBeGreaterThanOrEqual(30_000);
  });

  it("does not use the old 100-event page size that capped the US collect at 10k", () => {
    expect(DEFAULT_ONEPIECE_PAGE_SIZE).toBeGreaterThan(100);
    expect(DEFAULT_ONEPIECE_MAX_PAGES * 100).toBeLessThan(30_000);
  });
});
