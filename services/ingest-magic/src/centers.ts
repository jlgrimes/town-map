/**
 * The search circles the Wizards locator is asked about.
 *
 * The locator answers "what is near this point", so a city nobody searches is a
 * city with no events rather than an error, and coverage is exactly this list.
 * It lives in the repository instead of `MAGIC_SEARCH_CENTERS_JSON` because a
 * national catalog is too large to review as an environment variable, and
 * because a change to where Town Map claims coverage should show up in a diff.
 *
 * Radii are deliberately smaller than the area a metro's players will drive.
 * Circles may overlap: events deduplicate on `(source, source_event_id)` and
 * withdrawal is scoped to whichever region wrote a row last, so an event two
 * circles both return costs a repeated request and nothing else. What is not
 * cheap is a circle holding more events than `MAX_PAGES` can enumerate, which
 * is why dense metros are split rather than widened.
 */
export type SearchCenter = {
  key?: string;
  name: string;
  countryCode?: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  cadenceMinutes?: number;
  priority?: number;
  enabled?: boolean;
};

/** Rollout tier, lowest first. `claimNextCollectionRegion` orders by priority. */
const TIER_ONE = 10;

/**
 * The largest United States metropolitan areas.
 *
 * The full metropolitan catalog is enabled. Emergency stop is still
 * `COLLECTOR_ENABLED=false`; a staged rollback is `COLLECTOR_REGION_ALLOWLIST`.
 */
export const DEFAULT_SEARCH_CENTERS: SearchCenter[] = [
  { key: "us-il-chicago", name: "Chicago", countryCode: "US", latitude: 41.8781, longitude: -87.6298, radiusMeters: 100_000, priority: TIER_ONE },
  { key: "us-ca-san-francisco", name: "San Francisco", countryCode: "US", latitude: 37.7749, longitude: -122.4194, radiusMeters: 50_000, priority: TIER_ONE },
  { key: "us-ny-new-york", name: "New York", countryCode: "US", latitude: 40.7128, longitude: -74.0060, radiusMeters: 45_000, priority: TIER_ONE },
  { key: "us-ca-los-angeles", name: "Los Angeles", countryCode: "US", latitude: 34.0522, longitude: -118.2437, radiusMeters: 45_000, priority: TIER_ONE },
  { key: "us-tx-dallas", name: "Dallas–Fort Worth", countryCode: "US", latitude: 32.7767, longitude: -96.7970, radiusMeters: 60_000, priority: TIER_ONE },
  { key: "us-tx-houston", name: "Houston", countryCode: "US", latitude: 29.7604, longitude: -95.3698, radiusMeters: 60_000, priority: TIER_ONE },
  { key: "us-dc-washington", name: "Washington", countryCode: "US", latitude: 38.9072, longitude: -77.0369, radiusMeters: 55_000, priority: TIER_ONE },
  { key: "us-pa-philadelphia", name: "Philadelphia", countryCode: "US", latitude: 39.9526, longitude: -75.1652, radiusMeters: 50_000, priority: TIER_ONE },
  { key: "us-fl-miami", name: "Miami", countryCode: "US", latitude: 25.7617, longitude: -80.1918, radiusMeters: 55_000, priority: TIER_ONE },
  { key: "us-ga-atlanta", name: "Atlanta", countryCode: "US", latitude: 33.7490, longitude: -84.3880, radiusMeters: 60_000, priority: TIER_ONE },
  { key: "us-ma-boston", name: "Boston", countryCode: "US", latitude: 42.3601, longitude: -71.0589, radiusMeters: 50_000, priority: TIER_ONE },
  { key: "us-az-phoenix", name: "Phoenix", countryCode: "US", latitude: 33.4484, longitude: -112.0740, radiusMeters: 60_000, priority: TIER_ONE },
  { key: "us-ca-san-jose", name: "San Jose", countryCode: "US", latitude: 37.3382, longitude: -121.8863, radiusMeters: 45_000, priority: TIER_ONE },
  { key: "us-wa-seattle", name: "Seattle", countryCode: "US", latitude: 47.6062, longitude: -122.3321, radiusMeters: 55_000, priority: TIER_ONE },
  { key: "us-co-denver", name: "Denver", countryCode: "US", latitude: 39.7392, longitude: -104.9903, radiusMeters: 55_000, priority: TIER_ONE },
  { key: "us-mn-minneapolis", name: "Minneapolis", countryCode: "US", latitude: 44.9778, longitude: -93.2650, radiusMeters: 60_000, priority: TIER_ONE },
  { key: "us-mi-detroit", name: "Detroit", countryCode: "US", latitude: 42.3314, longitude: -83.0458, radiusMeters: 60_000, priority: TIER_ONE },
];

function requireFiniteNumber(value: unknown, field: string, index: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`MAGIC_SEARCH_CENTERS_JSON[${index}].${field} must be a finite number`);
  }
  return value;
}

export function parseSearchCenters(value: string): SearchCenter[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`MAGIC_SEARCH_CENTERS_JSON is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("MAGIC_SEARCH_CENTERS_JSON must be a non-empty array");
  }
  return parsed.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`MAGIC_SEARCH_CENTERS_JSON[${index}] must be an object`);
    }
    const center = entry as Record<string, unknown>;
    if (typeof center.name !== "string" || !center.name.trim()) {
      throw new Error(`MAGIC_SEARCH_CENTERS_JSON[${index}].name must be a non-empty string`);
    }
    const latitude = requireFiniteNumber(center.latitude, "latitude", index);
    const longitude = requireFiniteNumber(center.longitude, "longitude", index);
    const radiusMeters = requireFiniteNumber(center.radiusMeters, "radiusMeters", index);
    if (latitude < -90 || latitude > 90) {
      throw new Error(`MAGIC_SEARCH_CENTERS_JSON[${index}].latitude must be between -90 and 90`);
    }
    if (longitude < -180 || longitude > 180) {
      throw new Error(`MAGIC_SEARCH_CENTERS_JSON[${index}].longitude must be between -180 and 180`);
    }
    if (radiusMeters <= 0) {
      throw new Error(`MAGIC_SEARCH_CENTERS_JSON[${index}].radiusMeters must be greater than zero`);
    }
    return { ...center, name: center.name, latitude, longitude, radiusMeters } as SearchCenter;
  });
}

export function getSearchCenters(): SearchCenter[] {
  const configured = process.env.MAGIC_SEARCH_CENTERS_JSON;
  return configured ? parseSearchCenters(configured) : DEFAULT_SEARCH_CENTERS;
}
