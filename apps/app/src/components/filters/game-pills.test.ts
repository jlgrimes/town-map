import { describe, expect, it } from "vitest";
import { nextGameSelection } from "./game-pills";

describe("nextGameSelection", () => {
  it("picks one game from All", () => {
    expect(nextGameSelection([], "magic")).toEqual(["magic"]);
  });

  it("tapping the selected game returns to All", () => {
    expect(nextGameSelection(["magic"], "magic")).toEqual([]);
  });

  it("switching games is one tap", () => {
    expect(nextGameSelection(["magic"], "yugioh")).toEqual(["yugioh"]);
  });

  it("All clears a specific pick", () => {
    expect(nextGameSelection(["riftbound"], "all")).toEqual([]);
  });
});
