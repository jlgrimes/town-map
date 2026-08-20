import { describe, expect, it } from "vitest";
import { DEFAULT_SEARCH_CENTERS } from "./centers.js";

describe("Riftbound catalog", () => {
  it("is national, not Chicago-only", () => {
    expect(DEFAULT_SEARCH_CENTERS.length).toBeGreaterThan(2);
    expect(DEFAULT_SEARCH_CENTERS.some((center) => center.key === "us-il-chicago")).toBe(true);
    expect(DEFAULT_SEARCH_CENTERS.some((center) => center.key === "us-ny-new-york")).toBe(true);
    expect(DEFAULT_SEARCH_CENTERS.some((center) => center.key === "us-tx-el-paso")).toBe(true);
  });
});
