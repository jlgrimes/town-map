import { describe, expect, it } from "vitest";
import {
  MAGIC_FORMAT_CHIPS,
  formatChipsForEvents,
  matchesFormat,
  nextFormatSelection,
  playerFormat,
} from "./format-pills";

describe("nextFormatSelection", () => {
  it("picks one format from All", () => {
    expect(nextFormatSelection("all", "commander")).toBe("commander");
  });

  it("tapping the selected format returns to All", () => {
    expect(nextFormatSelection("commander", "commander")).toBe("all");
  });

  it("switching formats is one tap", () => {
    expect(nextFormatSelection("commander", "draft")).toBe("draft");
  });

  it("All clears a specific pick", () => {
    expect(nextFormatSelection("sealed", "all")).toBe("all");
  });
});

describe("playerFormat", () => {
  it("reads Standard from the payload, not the title", () => {
    expect(playerFormat("Standard")).toBe("standard");
    expect(matchesFormat("Standard", "standard")).toBe(true);
    expect(playerFormat("Constructed")).toBeNull();
    expect(MAGIC_FORMAT_CHIPS.some((chip) => chip.value === "standard" && chip.label === "Standard")).toBe(true);
    expect(formatChipsForEvents([{ format: "Standard" }]).some((chip) => chip.label === "Standard")).toBe(true);
  });

  it("does not ship Constructed as a chip", () => {
    expect(MAGIC_FORMAT_CHIPS.map((chip) => chip.label)).not.toContain("Constructed");
    expect(playerFormat("Constructed")).toBeNull();
  });

  it("hides a chip if that night has none", () => {
    const chips = formatChipsForEvents([
      { format: "Commander" },
      { format: "Standard" },
    ]);
    expect(chips.map((chip) => chip.label)).toEqual(["All formats", "Commander", "Standard"]);
    expect(chips.map((chip) => chip.label)).not.toContain("Pioneer");
  });

  it("reads Commander, Draft, and Sealed from the payload", () => {
    expect(playerFormat("Commander")).toBe("commander");
    expect(playerFormat("Draft")).toBe("draft");
    expect(playerFormat("Sealed")).toBe("sealed");
  });
});

describe("matchesFormat", () => {
  it("All keeps every row, including a missing format", () => {
    expect(matchesFormat("Commander", "all")).toBe(true);
    expect(matchesFormat(null, "all")).toBe(true);
  });

  it("Draft matches the payload Draft label", () => {
    expect(matchesFormat("Draft", "draft")).toBe(true);
    expect(matchesFormat("Booster Draft", "draft")).toBe(false);
  });

  it("Commander is not Draft", () => {
    expect(matchesFormat("Commander", "draft")).toBe(false);
  });
});
