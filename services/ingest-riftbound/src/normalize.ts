import type { NormalizedEvent } from "@town-map/contracts";

export type RiftboundEvent = {
  id: number | string;
  name: string;
  start_datetime: string;
  end_datetime?: string | null;
  description?: string | null;
  full_address?: string | null;
  event_status?: string | null;
  event_format?: string | null;
  event_type?: string | null;
  rules_enforcement_level?: string | null;
  timezone?: string | null;
  event_is_online?: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
  cost_in_cents?: number | null;
  currency?: string | null;
  capacity?: number | null;
  url?: string | null;
  display_status?: string | null;
  gameplay_format?: { id?: string | null; name?: string | null } | null;
  settings?: { event_lifecycle_status?: string | null; show_registration_button?: boolean | null } | null;
  store?: {
    id: number | string;
    name: string;
    full_address?: string | null;
    city?: string | null;
    country?: string | null;
    state?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    website?: string | null;
  } | null;
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

export function normalizeRiftboundEvent(event: RiftboundEvent): NormalizedEvent {
  const sourceUrl = `https://locator.riftbound.uvsgames.com/events/${encodeURIComponent(String(event.id))}`;
  const registrationUrl = normalizeUrl(event.url);
  return {
    sourceEventId: String(event.id),
    sourceSeriesId: null,
    game: "riftbound",
    title: event.name,
    description: optional(event.description),
    startsAt: new Date(event.start_datetime).toISOString(),
    endsAt: event.end_datetime ? new Date(event.end_datetime).toISOString() : null,
    timezone: optional(event.timezone),
    status: optional(event.settings?.event_lifecycle_status) ?? optional(event.event_status) ?? optional(event.display_status),
    format: optional(event.gameplay_format?.name) ?? optional(event.event_format),
    eventType: optional(event.event_type),
    sourceUrl,
    registrationUrl: registrationUrl === sourceUrl ? null : registrationUrl,
    priceAmount: event.cost_in_cents == null ? null : event.cost_in_cents / 100,
    priceCurrency: optional(event.currency)?.toUpperCase() ?? null,
    capacity: Number.isInteger(event.capacity) ? event.capacity! : null,
    isOnline: Boolean(event.event_is_online),
    venue: event.store ? {
      sourceVenueId: String(event.store.id),
      name: event.store.name,
      address: optional(event.store.full_address) ?? optional(event.full_address),
      city: optional(event.store.city),
      region: optional(event.store.state),
      postalCode: null,
      country: optional(event.store.country),
      latitude: coordinate(event.store.latitude ?? event.latitude, -90, 90),
      longitude: coordinate(event.store.longitude ?? event.longitude, -180, 180),
      website: normalizeUrl(event.store.website),
      phone: null,
    } : event.event_is_online ? null : {
      sourceVenueId: `event:${event.id}`,
      name: optional(event.full_address) ?? "Riftbound event venue",
      address: optional(event.full_address),
      city: null,
      region: null,
      postalCode: null,
      country: null,
      latitude: coordinate(event.latitude, -90, 90),
      longitude: coordinate(event.longitude, -180, 180),
      website: null,
      phone: null,
    },
    raw: event,
  };
}
