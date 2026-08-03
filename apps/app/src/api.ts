import {
  GameRegistrySchema,
  UserPreferencesSchema,
  type EventPage,
  type Game,
  type HomeLocation,
  type UserPreferences,
} from "@town-map/contracts";

const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(/\/$/, "");

/** Server page size. The API caps `limit` at 250. */
const EVENT_PAGE_SIZE = 200;

/**
 * Upper bound on pages followed for one query. The map draws every event it is
 * given, so results are gathered rather than paged on demand; this keeps a very
 * dense area from issuing unbounded requests.
 */
const MAX_EVENT_PAGES = 5;

export type EventFetchOptions = {
  games: Game[];
  latitude?: number;
  longitude?: number;
  radiusMiles?: number;
  signal?: AbortSignal;
};

function eventQueryParams(options: EventFetchOptions, cursor: string | null) {
  const params = new URLSearchParams({
    games: options.games.join(","),
    limit: String(EVENT_PAGE_SIZE),
  });
  if (options.latitude !== undefined && options.longitude !== undefined) {
    params.set("latitude", String(options.latitude));
    params.set("longitude", String(options.longitude));
    params.set("radiusMiles", String(options.radiusMiles ?? 25));
  }
  if (cursor) params.set("cursor", cursor);
  return params;
}

async function fetchEventPage(options: EventFetchOptions, cursor: string | null) {
  const response = await fetch(`${API_URL}/v1/events?${eventQueryParams(options, cursor)}`, {
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`Event API returned ${response.status}`);
  return response.json() as Promise<EventPage>;
}

/**
 * Follows the API's cursor until the results are exhausted or the page ceiling
 * is reached. `truncated` reports the latter so the caller can say results were
 * cut short instead of silently showing a partial map.
 */
export async function fetchEvents(options: EventFetchOptions) {
  const events: EventPage["events"] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
    const result: EventPage = await fetchEventPage(options, cursor);
    events.push(...result.events);
    cursor = result.nextCursor;
    if (!cursor) return { events, truncated: false };
  }
  return { events, truncated: true };
}

export async function fetchGameRegistry(signal?: AbortSignal) {
  const response = await fetch(`${API_URL}/v1/games`, { signal });
  if (!response.ok) throw new Error(`Game registry returned ${response.status}`);
  return GameRegistrySchema.parse(await response.json());
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

export function normalizeUserPreferences(value: unknown): UserPreferences {
  const current = UserPreferencesSchema.safeParse(value);
  if (current.success) return current.data;

  if (typeof value !== "object" || value === null || !("homeAddress" in value)) {
    throw new Error("Preferences API returned invalid data");
  }

  const legacy = UserPreferencesSchema.safeParse({
    homeAddress: value.homeAddress,
    selectedGames: [],
    onboardingCompleted: false,
  });
  if (!legacy.success) throw new Error("Preferences API returned invalid data");
  return legacy.data;
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
  return normalizeUserPreferences(await response.json());
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
  return UserPreferencesSchema.parse(await response.json());
}
