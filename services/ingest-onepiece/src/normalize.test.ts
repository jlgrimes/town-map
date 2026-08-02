import { describe, expect, it } from "vitest";
import { normalizeOnePieceEvent } from "./normalize.js";

describe("normalizeOnePieceEvent", () => {
  it("converts Bandai local time and coordinates", () => {
    const event = normalizeOnePieceEvent({
      id: 6919994,
      organizer_id: 10624,
      status_id: 11,
      start_datetime: "2026-08-01T14:00:00",
      timezone: "America/Chicago",
      event_series_title: "Store Tournament Event OP",
      organizer_name: "Evergreen Social",
      event_place_geo: { x: 41.7203, y: -87.694 },
      pref_code: "US-IL",
      country_code: "US",
      entryFee: "15.000",
      entry_fee_currency_code: "$",
      game_format_ids: [226],
    });
    expect(event).toMatchObject({
      sourceEventId: "6919994",
      game: "onepiece",
      startsAt: "2026-08-01T19:00:00.000Z",
      format: "Constructed: Standard Regulation",
      priceAmount: 15,
      priceCurrency: "USD",
      venue: { sourceVenueId: "10624", region: "IL", latitude: 41.7203, longitude: -87.694 },
    });
  });
});
