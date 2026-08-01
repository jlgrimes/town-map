import type { EventListItem, Game } from "@town-map/contracts";

const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(/\/$/, "");

export async function fetchEvents(options: {
  games: Game[];
  latitude?: number;
  longitude?: number;
  radiusMiles?: number;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams({ games: options.games.join(","), limit: "200" });
  if (options.latitude !== undefined && options.longitude !== undefined) {
    params.set("latitude", String(options.latitude));
    params.set("longitude", String(options.longitude));
    params.set("radiusMiles", String(options.radiusMiles ?? 25));
  }
  const response = await fetch(`${API_URL}/v1/events?${params}`, { signal: options.signal });
  if (!response.ok) throw new Error(`Event API returned ${response.status}`);
  return response.json() as Promise<{ events: EventListItem[]; count: number }>;
}

export async function geocodePlace(query: string, signal?: AbortSignal) {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "1",
    addressdetails: "1",
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error(`Location search returned ${response.status}`);
  const results = await response.json() as Array<{
    lat: string;
    lon: string;
    display_name: string;
    name?: string;
    address?: { city?: string; town?: string; village?: string; state?: string; postcode?: string };
  }>;
  const result = results[0];
  if (!result) return null;
  const city = result.address?.city ?? result.address?.town ?? result.address?.village ?? result.name;
  const region = result.address?.state;
  return {
    latitude: Number(result.lat),
    longitude: Number(result.lon),
    label: [city, region].filter(Boolean).join(", ") || result.display_name.split(",").slice(0, 2).join(","),
  };
}
