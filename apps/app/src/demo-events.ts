import type { EventListItem, Game } from "@town-map/contracts";

const upcoming = (days: number, hour: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};

function event(
  id: string,
  game: Game,
  title: string,
  days: number,
  hour: number,
  venue: string,
  city: string,
  distanceMiles: number,
  extras: Partial<EventListItem> = {},
): EventListItem {
  return {
    id,
    source: game === "magic" ? "wotc-locator" : game === "yugioh" ? "konami-kcgn" : "pokedata-events",
    sourceEventId: id,
    game,
    title,
    description: null,
    startsAt: upcoming(days, hour),
    endsAt: null,
    timezone: "America/Chicago",
    status: "scheduled",
    format: null,
    eventType: "Local",
    sourceUrl: "https://example.com/events/demo",
    registrationUrl: null,
    priceAmount: null,
    priceCurrency: "USD",
    capacity: null,
    isOnline: false,
    distanceMiles,
    venue: {
      name: venue,
      address: null,
      city,
      region: "IL",
      postalCode: null,
      latitude: 41.88 + Number(id.slice(-1)) * 0.009,
      longitude: -87.63 - Number(id.slice(-1)) * 0.014,
      website: null,
    },
    ...extras,
  };
}

export const demoEvents: EventListItem[] = [
  event("demo-1", "magic", "Friday Night Magic — Commander", 0, 19, "Good Games Chicago", "Chicago", 1.8, { format: "Commander", priceAmount: 10 }),
  event("demo-2", "pokemon", "Pokémon League Challenge", 1, 11, "Dice Dojo", "Chicago", 3.4, { format: "Standard", eventType: "League Challenge" }),
  event("demo-3", "yugioh", "Saturday Advanced Local", 1, 14, "Gamers World", "Chicago", 4.9, { format: "Advanced", capacity: 24 }),
  event("demo-4", "magic", "Modern Monday", 3, 18, "Grandmaster Games", "Oak Park", 8.2, { format: "Modern", priceAmount: 15 }),
  event("demo-5", "pokemon", "Casual Pokémon League", 4, 17, "Prism Games", "Logan Square", 2.6, { eventType: "League" }),
  event("demo-6", "yugioh", "OTS Championship", 6, 12, "Pastimes Comics & Games", "Niles", 14.1, { eventType: "OTS Championship", capacity: 64 }),
];
