import { describe, expect, it } from "vitest";
import { DATE_OPTIONS, DEFAULT_RADIUS_MILES } from "./filter-bar";

describe("Discover filters", () => {
  it("exposes Today as the first dated window so Tonight can be the default product path", () => {
    const dated = DATE_OPTIONS.filter((option) => option.value !== "all");
    expect(dated[0]?.value).toBe("today");
    expect(dated[0]?.label).toMatch(/today/i);
  });

  it("defaults distance to a local search, not a region", () => {
    expect(DEFAULT_RADIUS_MILES).toBe(25);
  });
});
