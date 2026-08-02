import type { EventListItem, EventSource, Game } from "@town-map/contracts";

const DEMO_SOURCES: Record<Game, EventSource> = {
  pokemon: "pokedata-events",
  magic: "wotc-locator",
  yugioh: "konami-kcgn",
  onepiece: "bandai-tcg-plus",
  riftbound: "riftbound-locator",
};

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
    source: DEMO_SOURCES[game],
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

const goodGamesEvent = event("demo-1", "magic", "Friday Night Magic — Commander", 0, 19, "Good Games Chicago", "Chicago", 1.8, { format: "Commander", priceAmount: 10 });

export const demoEvents: EventListItem[] = [
  goodGamesEvent,
  event("demo-7", "pokemon", "Pokémon League at Good Games", 2, 18, "Good Games Chicago", "Chicago", 1.8, {
    eventType: "League",
    venue: goodGamesEvent.venue,
  }),
  event("demo-8", "yugioh", "Yu-Gi-Oh! Locals at Good Games", 4, 19, "Good Games Chicago", "Chicago", 1.8, {
    format: "Advanced",
    venue: goodGamesEvent.venue,
  }),
  event("demo-9", "onepiece", "One Piece Store Tournament", 3, 18, "Good Games Chicago", "Chicago", 1.8, {
    format: "Standard Regulation",
    venue: goodGamesEvent.venue,
  }),
  event("demo-10", "riftbound", "Riftbound Nexus Night", 5, 18, "Good Games Chicago", "Chicago", 1.8, {
    format: "Constructed",
    venue: goodGamesEvent.venue,
  }),
  event("demo-2", "pokemon", "Pokémon League Challenge", 1, 11, "Dice Dojo", "Chicago", 3.4, { format: "Standard", eventType: "League Challenge" }),
  event("demo-3", "yugioh", "Saturday Advanced Local", 1, 14, "Gamers World", "Chicago", 4.9, { format: "Advanced", capacity: 24 }),
  event("demo-4", "magic", "Modern Monday", 3, 18, "Grandmaster Games", "Oak Park", 8.2, { format: "Modern", priceAmount: 15 }),
  event("demo-5", "pokemon", "Casual Pokémon League", 4, 17, "Prism Games", "Logan Square", 2.6, { eventType: "League" }),
  event("demo-6", "yugioh", "OTS Championship", 6, 12, "Pastimes Comics & Games", "Niles", 14.1, { eventType: "OTS Championship", capacity: 64 }),
];
