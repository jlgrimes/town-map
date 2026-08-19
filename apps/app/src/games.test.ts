import { describe, expect, it } from "vitest";
import { gameIconUrl, gameMarkerUrl } from "./games";

describe("game assets", () => {
  it("keeps Magic, YGO, and Riftbound on real markers", () => {
    expect(gameIconUrl("magic")).toBe("/planeswalk.png");
    expect(gameIconUrl("yugioh")).toBe("/blue-eyes.png");
    expect(gameMarkerUrl("riftbound")).toBe("/riftbound.png");
  });

  it("falls back instead of breaking the map for an unknown game", () => {
    expect(gameIconUrl("chess")).toBe("/event.svg");
    expect(gameMarkerUrl("chess")).toBe("/event.png");
  });
});
