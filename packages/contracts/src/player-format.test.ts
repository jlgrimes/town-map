import { describe, expect, it } from "vitest";
import { playerMagicFormat, withPlayerMagicFormat } from "./player-format.js";

describe("playerMagicFormat", () => {
  it("Standard in the title lands on Standard, not Constructed", () => {
    expect(playerMagicFormat("Constructed", "Friday Night Magic Standard")).toBe("Standard");
  });

  it("derives Modern and Pioneer from the title when WPN says Constructed", () => {
    expect(playerMagicFormat("Constructed", "Modern FNM")).toBe("Modern");
    expect(playerMagicFormat("Constructed", "Pioneer Challenge")).toBe("Pioneer");
  });

  it("does not ship Constructed", () => {
    expect(playerMagicFormat("Constructed", "Friday Night Magic")).toBeNull();
  });

  it("maps Commander, Booster Draft, and Sealed from the payload format", () => {
    expect(playerMagicFormat("Commander", "Commander Night")).toBe("Commander");
    expect(playerMagicFormat("Booster Draft", "Friday Night Magic")).toBe("Draft");
    expect(playerMagicFormat("Sealed Deck", "Prerelease")).toBe("Sealed");
    expect(playerMagicFormat("Sealed", "Prerelease")).toBe("Sealed");
  });
});

describe("withPlayerMagicFormat", () => {
  it("rewrites Magic events and leaves other games alone", () => {
    expect(withPlayerMagicFormat({
      game: "magic",
      format: "Constructed",
      title: "Friday Night Magic Standard",
    }).format).toBe("Standard");
    expect(withPlayerMagicFormat({
      game: "yugioh",
      format: "Constructed",
      title: "Friday Night Magic Standard",
    }).format).toBe("Constructed");
  });
});
