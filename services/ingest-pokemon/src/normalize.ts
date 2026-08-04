import type { NormalizedEvent } from "@town-map/contracts";
import { fromZonedTime } from "date-fns-tz";
import tzLookup from "tz-lookup";

export type PokedataEvent = {
  type: string;
  name: string;
  date: string;
  shop: string;
  street_adress: string;
  state: string;
  city: string;
  postal_code: string;
  country_code: string;
  pokemon_url: string;
  guid: string;
  latitude: string;
  longitude: string;
  when: string;
  status: string;
  totalPlayers: string;
  TCaccounts: string;
  juniors: string;
  seniors: string;
  masters: string;
  league: string;
  category: string;
  tournament_date: string;
  tournament_completed: string;
  date_added: string;
};

function optional(value: string) {
  return value.trim() || null;
}

function coordinate(value: string, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function eventUrl(value: string) {
  if (!value.trim()) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://www.pokemon.com/us/pokemon-trainer-club/play-pokemon-tournaments/${encodeURIComponent(value)}/`;
}

export function normalizePokemonEvent(row: PokedataEvent): NormalizedEvent {
  const latitude = coordinate(row.latitude, -90, 90);
  const longitude = coordinate(row.longitude, -180, 180);
  const timezone = latitude == null || longitude == null ? null : tzLookup(latitude, longitude);
  const localDateTime = row.when.replace(" ", "T");
  const startsAt = timezone
    ? fromZonedTime(localDateTime, timezone).toISOString()
    : new Date(`${localDateTime}Z`).toISOString();
  const sourceVenueId = optional(row.league) ?? `${row.shop.trim()}|${row.street_adress.trim()}`;

  return {
    sourceEventId: row.guid,
    sourceSeriesId: null,
    game: "pokemon",
    title: row.name,
    description: null,
    startsAt,
    endsAt: null,
    timezone,
    status: optional(row.status),
    format: optional(row.category),
    eventType: optional(row.type),
    sourceUrl: eventUrl(row.pokemon_url),
    registrationUrl: null,
    priceAmount: null,
    priceCurrency: null,
    capacity: null,
    isOnline: false,
    venue: {
      sourceVenueId,
      name: row.shop,
      address: optional(row.street_adress),
      city: optional(row.city),
      region: optional(row.state),
      postalCode: optional(row.postal_code),
      country: optional(row.country_code),
      latitude,
      longitude,
      website: null,
      phone: null,
    },
    raw: row,
  };
}
