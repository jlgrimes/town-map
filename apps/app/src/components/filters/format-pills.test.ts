import { describe, expect, it } from "vitest";
import { matchesFormat, nextFormatSelection } from "./format-pills";

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

describe("matchesFormat", () => {
  it("All keeps every row, including a missing format", () => {
    expect(matchesFormat("Commander", "all")).toBe(true);
    expect(matchesFormat(null, "all")).toBe(true);
  });

  it("Draft matches live WPN Booster Draft labels", () => {
    expect(matchesFormat("Booster Draft", "draft")).toBe(true);
    expect(matchesFormat("booster_draft", "draft")).toBe(true);
  });

  it("matches live WPN Commander, Constructed, and Sealed labels", () => {
    expect(matchesFormat("Commander", "commander")).toBe(true);
    expect(matchesFormat("Constructed", "constructed")).toBe(true);
    expect(matchesFormat("Sealed", "sealed")).toBe(true);
  });

  it("Commander is not Draft", () => {
    expect(matchesFormat("Commander", "draft")).toBe(false);
  });
});
