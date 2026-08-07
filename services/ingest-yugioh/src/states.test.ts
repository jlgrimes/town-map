import { describe, expect, it } from "vitest";
import { DEFAULT_STATES, parseStates } from "./states.js";

describe("DEFAULT_STATES", () => {
  it("covers every state and the District of Columbia", () => {
    expect(DEFAULT_STATES).toHaveLength(51);
    expect(DEFAULT_STATES.map((state) => state.code)).toContain("DC");
  });

  it("keeps Illinois enabled, since its events are already filed under US:IL", () => {
    expect(DEFAULT_STATES.find((state) => state.code === "IL")?.enabled).not.toBe(false);
  });

  it("registers the catalog beyond the measured cohort as disabled", () => {
    const enabled = DEFAULT_STATES.filter((state) => state.enabled !== false);
    expect(enabled.map((state) => state.code)).toEqual(["IL", "CA"]);
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

describe("parseStates", () => {
  it("accepts a list in any casing or spacing", () => {
    expect(parseStates(" il , ca ")).toEqual([{ code: "IL" }, { code: "CA" }]);
  });

  it("collapses a repeated state", () => {
    expect(parseStates("CA,CA")).toEqual([{ code: "CA" }]);
  });

  // KCGN answers an unrecognised state with an empty result rather than an
  // error, so a typo collected nothing and reported success.
  it("rejects a code the endpoint cannot filter on", () => {
    expect(() => parseStates("CA,Illinois")).toThrow(/unknown state code\(s\): ILLINOIS/);
    expect(() => parseStates("XX")).toThrow(/unknown state code/);
  });

  it("rejects an empty list", () => {
    expect(() => parseStates(" , ")).toThrow(/at least one state/);
  });
});
