import { describe, expect, it } from "vitest";
import { normalizeYugiohEvent } from "./normalize.js";

describe("normalizeYugiohEvent", () => {
  it("uses the stable tournament and store identifiers", () => {
    const event = normalizeYugiohEvent({
      tournamentNo: "E26-1",
      tournamentName: "Friday Local",
      tournamentDate: Date.parse("2026-08-01T00:00:00Z"),
      storeCode: "550001US",
      storeName: "Card Shop",
    });
    expect(event).toMatchObject({ sourceEventId: "E26-1", game: "yugioh", venue: { sourceVenueId: "550001US" } });
    expect(event.sourceUrl).toBe("https://cardgame-network.konami.net/tournament_info/E26-1");
  });
});
