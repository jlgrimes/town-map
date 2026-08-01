import type { NormalizedEvent } from "@town-map/contracts";

export type KonamiTournament = {
  tournamentNo: string;
  tournamentName: string;
  tournamentDate: number;
  tournamentDateEnd?: number | null;
  tournamentStatus?: string | null;
  eventId?: number | null;
  eventName?: string | null;
  eventUrl?: string | null;
  forecastPlayerNumber?: number | null;
  longitude?: number | null;
  latitude?: number | null;
  storeCode?: string | null;
  storeName?: string | null;
  locationName?: string | null;
  address?: string | null;
  nationCode?: string | null;
  structure?: string | null;
  location?: {
    locationId?: number | null;
    address1?: string | null;
    address2?: string | null;
    address3?: string | null;
    locationName?: string | null;
    nationCode?: string | null;
    postalCode?: string | null;
    telNo?: string | null;
    stateCode?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
};

export function normalizeYugiohEvent(event: KonamiTournament): NormalizedEvent {
  const location = event.location;
  const sourceVenueId = event.storeCode ?? String(location?.locationId ?? event.locationName ?? event.address);
  const address = [location?.address1, location?.address2, location?.address3].filter(Boolean).join(", ") || event.address || null;
  return {
    sourceEventId: event.tournamentNo,
    game: "yugioh",
    title: event.tournamentName,
    description: null,
    startsAt: new Date(event.tournamentDate).toISOString(),
    endsAt: event.tournamentDateEnd ? new Date(event.tournamentDateEnd).toISOString() : null,
    timezone: null,
    status: event.tournamentStatus ?? null,
    format: event.structure ?? null,
    eventType: event.eventName ?? null,
    sourceUrl: `https://cardgame-network.konami.net/tournament_info/${encodeURIComponent(event.tournamentNo)}`,
    registrationUrl: event.eventUrl || null,
    priceAmount: null,
    priceCurrency: null,
    capacity: event.forecastPlayerNumber ?? null,
    isOnline: /remote/i.test(`${event.eventName ?? ""} ${event.tournamentName}`),
    venue: sourceVenueId ? {
      sourceVenueId,
      name: event.locationName ?? location?.locationName ?? event.storeName ?? "Yu-Gi-Oh! venue",
      address,
      city: location?.address1 ?? null,
      region: location?.stateCode ?? null,
      postalCode: location?.postalCode ?? null,
      country: location?.nationCode ?? event.nationCode ?? null,
      latitude: event.latitude ?? location?.latitude ?? null,
      longitude: event.longitude ?? location?.longitude ?? null,
      website: null,
      phone: location?.telNo ?? null,
    } : null,
    raw: event,
  };
}
