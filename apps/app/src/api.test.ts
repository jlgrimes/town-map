import { describe, expect, it } from "vitest";
import { normalizeUserPreferences } from "./api";

describe("normalizeUserPreferences", () => {
  it("accepts current onboarding preferences", () => {
    expect(normalizeUserPreferences({
      homeAddress: "Chicago, IL",
      selectedGames: ["magic", "pokemon"],
      onboardingCompleted: true,
    })).toEqual({
      homeAddress: "Chicago, IL",
      selectedGames: ["magic", "pokemon"],
      onboardingCompleted: true,
    });
  });

  it("treats a legacy home-only response as incomplete onboarding", () => {
    expect(normalizeUserPreferences({ homeAddress: "Chicago, IL" })).toEqual({
      homeAddress: "Chicago, IL",
      selectedGames: [],
      onboardingCompleted: false,
    });
  });

  it("rejects malformed preference responses", () => {
    expect(() => normalizeUserPreferences({ selectedGames: [] })).toThrow("invalid data");
  });
});
