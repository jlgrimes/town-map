import type { EventPage, Game, HomeLocation, UserPreferences } from "@town-map/contracts";

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
  return response.json() as Promise<EventPage>;
}

export async function geocodePlace(query: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ q: query });
  const response = await fetch(`${API_URL}/v1/geocode?${params}`, { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Location search returned ${response.status}`);
  return response.json() as Promise<HomeLocation>;
}

async function authorizationHeaders(getToken: () => Promise<string | null>) {
  const token = await getToken();
  if (!token) throw new Error("No active Clerk session");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function fetchUserPreferences(
  getToken: () => Promise<string | null>,
  signal?: AbortSignal,
) {
  const response = await fetch(`${API_URL}/v1/preferences`, {
    headers: await authorizationHeaders(getToken),
    signal,
  });
  if (!response.ok) throw new Error(`Preferences API returned ${response.status}`);
  return response.json() as Promise<UserPreferences>;
}

export async function saveUserPreferences(
  preferences: { homeAddress: string; selectedGames: Game[] },
  getToken: () => Promise<string | null>,
) {
  const response = await fetch(`${API_URL}/v1/preferences`, {
    method: "PUT",
    headers: await authorizationHeaders(getToken),
    body: JSON.stringify(preferences),
  });
  if (!response.ok) throw new Error(`Preferences API returned ${response.status}`);
  return response.json() as Promise<UserPreferences>;
}
