import { describe, expect, it } from "vitest";
import { normalizePokemonEvent, type PokedataEvent } from "./normalize.js";

const fixture: PokedataEvent = {
  type: "League Challenge",
  name: "Saturday League Challenge",
  date: "2026-08-01",
  shop: "DICE DOJO",
  street_adress: "5550 N BROADWAY, CHICAGO, IL 60640, US",
  state: "Illinois",
  city: "Chicago",
  postal_code: "60640",
  country_code: "US",
  pokemon_url: "26-08-123456",
  guid: "95dfd1bc-b955-4583-bbd5-b47c808fbe4e",
  latitude: "41.9822",
  longitude: "-87.6608",
  when: "2026-08-01 19:00:00",
  status: "",
  totalPlayers: "0",
  TCaccounts: "0",
  juniors: "0",
  seniors: "0",
  masters: "0",
  league: "1234567",
  category: "Standard",
  tournament_date: "",
  tournament_completed: "",
  date_added: "2026-07-20",
};

describe("normalizePokemonEvent", () => {
  it("keeps stable IDs and converts the venue-local time to UTC", () => {
    const event = normalizePokemonEvent(fixture);
    expect(event).toMatchObject({
      sourceEventId: fixture.guid,
      game: "pokemon",
      startsAt: "2026-08-02T00:00:00.000Z",
      timezone: "America/Chicago",
      venue: { sourceVenueId: "1234567", postalCode: "60640" },
    });
    expect(event.sourceUrl).toContain("26-08-123456");
    expect(event.registrationUrl).toBeNull();
  });
});
