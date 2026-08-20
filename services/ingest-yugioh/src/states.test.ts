import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_STATES, getStates, parseStates } from "./states.js";

describe("DEFAULT_STATES", () => {
  it("covers every state and the District of Columbia", () => {
    expect(DEFAULT_STATES).toHaveLength(51);
    expect(DEFAULT_STATES.map((state) => state.code)).toContain("DC");
  });

  it("keeps Illinois enabled, since its events are already filed under US:IL", () => {
    expect(DEFAULT_STATES.find((state) => state.code === "IL")?.enabled).not.toBe(false);
  });

  it("enables every region in the catalog", () => {
    expect(DEFAULT_STATES.every((state) => state.enabled !== false)).toBe(true);
    expect(DEFAULT_STATES).toHaveLength(51);
  });

  it("gives every state a unique two-letter code and a rollout tier", () => {
    const codes = DEFAULT_STATES.map((state) => state.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const state of DEFAULT_STATES) {
      expect(state.code).toMatch(/^[A-Z]{2}$/);
      expect(state.priority).toBeGreaterThan(0);
    }
  });
});

describe("getStates", () => {
  afterEach(() => {
    delete process.env.YUGIOH_STATES;
  });

  it("uses the full catalog even when YUGIOH_STATES pins Illinois", () => {
    process.env.YUGIOH_STATES = "IL";
    expect(getStates()).toHaveLength(51);
    expect(getStates().map((state) => state.code)).toContain("CA");
    expect(getStates().map((state) => state.code)).toContain("TX");
  });
});

describe("parseStates", () => {
  it("accepts a list in any casing or spacing", () => {
    expect(parseStates(" il , ca ")).toEqual([{ code: "IL" }, { code: "CA" }]);
  });

  it("collapses a repeated state", () => {
    expect(parseStates("CA,CA")).toEqual([{ code: "CA" }]);
  });

  it("rejects a code the endpoint cannot filter on", () => {
    expect(() => parseStates("CA,Illinois")).toThrow(/unknown state code\(s\): ILLINOIS/);
    expect(() => parseStates("XX")).toThrow(/unknown state code/);
  });

  it("rejects an empty list", () => {
    expect(() => parseStates(" , ")).toThrow(/at least one state/);
  });
});
