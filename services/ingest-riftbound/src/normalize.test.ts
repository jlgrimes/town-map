import { describe, expect, it } from "vitest";
import { normalizeRiftboundEvent } from "./normalize.js";

describe("normalizeRiftboundEvent", () => {
  it("normalizes locator pricing, format, and venue identity", () => {
    const event = normalizeRiftboundEvent({
      id: 668646,
      name: "Warpstorm Nexus Nights 1v1",
      start_datetime: "2026-08-01T23:00:00+00:00",
      end_datetime: "2026-08-02T03:10:00+00:00",
      event_status: "SCHEDULED",
      event_type: "LOCALS",
      timezone: "America/Chicago",
      cost_in_cents: 1000,
      currency: "USD",
      capacity: 32,
      gameplay_format: { name: "Constructed" },
      store: {
        id: 5317,
        name: "Warpstorm Games & Lounge",
        city: "Greenfield",
        state: "WI",
        country: "US",
        latitude: 42.9598,
        longitude: -87.9902,
      },
    });
    expect(event).toMatchObject({
      sourceEventId: "668646",
      game: "riftbound",
      format: "Constructed",
      priceAmount: 10,
      capacity: 32,
      venue: { sourceVenueId: "5317", region: "WI" },
    });
    expect(event.sourceUrl).toBe("https://locator.riftbound.uvsgames.com/events/668646");
  });
});
