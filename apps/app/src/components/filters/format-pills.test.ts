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
  it("Standard in the title lands on the Standard chip", () => {
    expect(playerFormat("Constructed", "Friday Night Magic Standard")).toBe("standard");
    expect(matchesFormat("Constructed", "standard", "Friday Night Magic Standard")).toBe(true);
    expect(MAGIC_FORMAT_CHIPS.some((chip) => chip.value === "standard" && chip.label === "Standard")).toBe(true);
    expect(
      formatChipsForEvents([{ format: "Constructed", title: "Friday Night Magic Standard" }]).some(
        (chip) => chip.label === "Standard",
      ),
    ).toBe(true);
  });

  it("derives Modern and Pioneer from the title when WPN says Constructed", () => {
    expect(playerFormat("Constructed", "Modern FNM")).toBe("modern");
    expect(playerFormat("Constructed", "Pioneer Challenge")).toBe("pioneer");
  });

  it("does not ship Constructed as a chip", () => {
    expect(MAGIC_FORMAT_CHIPS.some((chip) => chip.value === "constructed" || chip.label === "Constructed")).toBe(false);
    expect(playerFormat("Constructed", "Friday Night Magic")).toBeNull();
  });

  it("keeps Commander, Draft, and Sealed from the payload format", () => {
    expect(playerFormat("Commander", "Commander Night")).toBe("commander");
    expect(playerFormat("Booster Draft", "Friday Night Magic")).toBe("draft");
    expect(playerFormat("Sealed", "Prerelease")).toBe("sealed");
  });
});

describe("matchesFormat", () => {
  it("All keeps every row, including a missing format", () => {
    expect(matchesFormat("Commander", "all")).toBe(true);
    expect(matchesFormat(null, "all")).toBe(true);
  });

  it("Draft matches live WPN Booster Draft labels", () => {
    expect(matchesFormat("Booster Draft", "draft")).toBe(true);
    expect(matchesFormat("booster_draft", "draft")).toBe(true);
  });

  it("Commander is not Draft", () => {
    expect(matchesFormat("Commander", "draft")).toBe(false);
  });
});
