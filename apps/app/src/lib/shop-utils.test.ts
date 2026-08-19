import { describe, expect, it } from "vitest";
import { extractShopFromEvent, matchesShopSlug, slugifyShop } from "./shop-utils";
import type { EventListItem } from "@town-map/contracts";

describe("slugifyShop", () => {
  it("builds a city-qualified slug", () => {
    expect(slugifyShop("Guardian Games", "Portland")).toBe("guardian-games-portland");
  });

  it("does not duplicate a city already in the name", () => {
    expect(slugifyShop("Portland Game Store", "Portland")).toBe("portland-game-store");
  });

  it("strips accents", () => {
    expect(slugifyShop("Café du Jeu", "Montréal")).toBe("cafe-du-jeu-montreal");
  });
});

describe("extractShopFromEvent", () => {
  it("returns null when the event has no venue", () => {
    expect(extractShopFromEvent({ venue: null } as EventListItem)).toBeNull();
  });
});

describe("matchesShopSlug", () => {
  it("matches the generated slug", () => {
    expect(matchesShopSlug("Guardian Games", "Portland", "guardian-games-portland")).toBe(true);
  });
});
