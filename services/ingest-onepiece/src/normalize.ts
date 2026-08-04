import type { NormalizedEvent } from "@town-map/contracts";
import { fromZonedTime } from "date-fns-tz";

export type BandaiEvent = {
  id: number | string;
  organizer_id: number | string;
  status_id?: number | string | null;
  start_datetime: string;
  timezone?: string | null;
  max_join_count?: number | null;
  country_code?: string | null;
  pref_code?: string | null;
  postcode?: string | null;
  city_code?: string | null;
  street_address?: string | null;
  event_place_geo?: { x?: number | null; y?: number | null } | null;
  place_geo?: { x?: number | null; y?: number | null } | null;
  event_series_id?: string | number | null;
  series_type?: number | null;
  online_flag?: string | number | null;
  organizer_name: string;
  phone_number?: string | null;
  organizer_sns_url?: string | null;
  organizer_url?: string | null;
  notes?: string | null;
  excerpt?: string | null;
  event_series_title: string;
  entryFee?: string | number | null;
  entry_fee_currency_code?: string | null;
  is_canceled?: boolean | null;
  no_use_tcg_plus?: boolean | null;
  game_format_ids?: number[] | null;
};

const FORMAT_NAMES: Record<number, string> = {
  9: "Constructed",
  10: "Deck Limited",
  226: "Constructed: Standard Regulation",
};

function optional(value?: string | null) {
  return value?.trim() || null;
}

function normalizeUrl(value?: string | null) {
  const trimmed = optional(value);
  if (!trimmed) return null;
  try {
    return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).toString();
  } catch {
    return null;
  }
}

function coordinate(value: number | null | undefined, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function startsAt(event: BandaiEvent) {
  if (/[zZ]$|[+-]\d\d:\d\d$/.test(event.start_datetime)) {
    return new Date(event.start_datetime).toISOString();
  }
  return fromZonedTime(event.start_datetime, event.timezone || "UTC").toISOString();
}

function currency(value: string | null | undefined, country: string | null | undefined) {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === "$" || normalized === "USA" || normalized === "US$") {
    return country?.toUpperCase() === "CA" ? "CAD" : "USD";
  }
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

function description(event: BandaiEvent) {
  const parts = [optional(event.notes), optional(event.excerpt)].filter((value): value is string => Boolean(value));
  return parts.length ? [...new Set(parts)].join("\n\n") : null;
}

export function normalizeOnePieceEvent(event: BandaiEvent): NormalizedEvent {
  const coordinates = event.event_place_geo ?? event.place_geo;
  const price = event.entryFee == null || event.entryFee === "" ? null : Number(event.entryFee);
  const formats = (event.game_format_ids ?? []).map((id) => FORMAT_NAMES[id] ?? `Format ${id}`);
  const sourceUrl = `https://www.bandai-tcg-plus.com/event/${encodeURIComponent(String(event.id))}`;

  return {
    sourceEventId: String(event.id),
    game: "onepiece",
    title: event.event_series_title,
    // Bandai groups its recurring events upstream; where present this is
    // authoritative and beats anything derived from the schedule.
    sourceSeriesId: event.event_series_id == null ? null : String(event.event_series_id),
    description: description(event),
    startsAt: startsAt(event),
    endsAt: null,
    timezone: optional(event.timezone),
    status: event.is_canceled ? "canceled" : "scheduled",
    format: formats.length ? formats.join(", ") : null,
    eventType: null,
    sourceUrl,
    registrationUrl: null,
    priceAmount: price !== null && Number.isFinite(price) ? price : null,
    priceCurrency: currency(event.entry_fee_currency_code, event.country_code),
    capacity: Number.isInteger(event.max_join_count) ? event.max_join_count! : null,
    isOnline: String(event.online_flag ?? "0") === "1",
    venue: {
      sourceVenueId: String(event.organizer_id),
      name: event.organizer_name,
      address: optional(event.street_address),
      city: optional(event.city_code),
      region: optional(event.pref_code)?.replace(/^[A-Z]{2}-/, "") ?? null,
      postalCode: optional(event.postcode),
      country: optional(event.country_code),
      latitude: coordinate(coordinates?.x, -90, 90),
      longitude: coordinate(coordinates?.y, -180, 180),
      website: normalizeUrl(event.organizer_url) ?? normalizeUrl(event.organizer_sns_url),
      phone: optional(event.phone_number),
    },
    raw: event,
  };
}
