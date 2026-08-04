import type { NormalizedEvent } from "@town-map/contracts";

export type WotcEvent = {
  id: string;
  capacity?: number | null;
  description?: string | null;
  emailAddress?: string | null;
  isOnline?: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
  phoneNumber?: string | null;
  scheduledStartTime: string;
  status?: string | null;
  tags?: string[] | null;
  timeZone?: string | null;
  title: string;
  entryFee?: { amount?: number | null; currency?: string | null } | null;
  eventFormat?: { id?: string | null; name?: string | null } | null;
  organization?: {
    id: string;
    name: string;
    postalAddress?: string | null;
    website?: string | null;
  } | null;
};

function normalizeUrl(value?: string | null) {
  if (!value?.trim()) return null;
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}

export function normalizeMagicEvent(event: WotcEvent): NormalizedEvent {
  return {
    sourceEventId: String(event.id),
    sourceSeriesId: null,
    game: "magic",
    title: event.title,
    description: event.description ?? null,
    startsAt: new Date(event.scheduledStartTime).toISOString(),
    endsAt: null,
    timezone: event.timeZone ?? null,
    status: event.status ?? null,
    format: event.eventFormat?.name ?? event.eventFormat?.id ?? null,
    eventType: event.tags?.find((tag) => !tag.startsWith("magic:")) ?? null,
    sourceUrl: `https://locator.wizards.com/event/${encodeURIComponent(String(event.id))}`,
    registrationUrl: null,
    priceAmount: event.entryFee?.amount == null ? null : event.entryFee.amount / 100,
    priceCurrency: event.entryFee?.currency ?? null,
    capacity: event.capacity ?? null,
    isOnline: Boolean(event.isOnline),
    venue: event.organization ? {
      sourceVenueId: String(event.organization.id),
      name: event.organization.name,
      address: event.organization.postalAddress ?? null,
      city: null,
      region: null,
      postalCode: null,
      country: null,
      latitude: event.latitude ?? null,
      longitude: event.longitude ?? null,
      website: normalizeUrl(event.organization.website),
      phone: event.phoneNumber ?? null,
    } : null,
    raw: event,
  };
}
