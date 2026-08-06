import { describe, expect, it } from "vitest";
import { normalizeMagicEvent } from "./normalize.js";

describe("normalizeMagicEvent", () => {
  it("preserves the source identity and venue", () => {
    const event = normalizeMagicEvent({
      id: "evt-1",
      title: "Friday Night Magic",
      scheduledStartTime: "2026-08-01T00:00:00Z",
      entryFee: { amount: 500, currency: "USD" },
      organization: { id: "store-1", name: "The Game Store" },
    });
    expect(event).toMatchObject({ sourceEventId: "evt-1", game: "magic", venue: { sourceVenueId: "store-1" } });
    expect(event.sourceUrl).toBe("https://locator.wizards.com/event/evt-1");
    expect(event.priceAmount).toBe(5);
  });

  it.each([
    ["America/Chicago", "America/Chicago"],
    ["  America/Chicago  ", "America/Chicago"],
    ["", null],
    ["   ", null],
    ["Eastern Standard Time", null],
    [undefined, null],
  ])("resolves the published time zone %j to %j", (published, expected) => {
    const event = normalizeMagicEvent({
      id: "evt-1",
      title: "Friday Night Magic",
      scheduledStartTime: "2026-08-01T00:00:00Z",
      timeZone: published,
    });
    expect(event.timezone).toBe(expected);
  });
});
