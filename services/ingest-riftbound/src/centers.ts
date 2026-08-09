/**
 * The search circles the Riftbound locator is asked about.
 *
 * The locator answers "what is near this point", so a place nobody searches is
 * a place with no events rather than an error, and coverage is exactly this
 * list. It lives in the repository instead of `RIFTBOUND_SEARCH_CENTERS_JSON`
 * for the same reason the Magic circle catalog does: a national catalog is too
 * large to review as an environment variable, and a change to where Town Map
 * claims coverage should show up in a diff.
 *
 * Radii are in miles, because `num_miles` is what this locator filters on.
 * They are larger than the Magic catalog's for the same cities: this source
 * holds far fewer events per circle, so covering the country between the metros
 * costs fill circles rather than a grid of small ones. Circles may overlap:
 * events deduplicate on `(source, source_event_id)` and withdrawal is scoped to
 * whichever region wrote a row last, so an event two circles both return costs
 * a repeated request and nothing else. What is not cheap is a circle holding
 * more events than `MAX_PAGES` can enumerate, which is why the dense metros
 * stay tight while the empty interior gets the wide circles.
 */
export type SearchCenter = {
  key?: string;
  name: string;
  countryCode?: string;
  latitude: number;
  longitude: number;
  radiusMiles: number;
  cadenceMinutes?: number;
  priority?: number;
  enabled?: boolean;
};

/** Rollout tiers, lowest first. `claimNextCollectionRegion` orders by priority. */
const TIER_ONE = 10;
const TIER_TWO = 20;
const TIER_THREE = 30;

type Circle = Pick<SearchCenter, "key" | "name" | "latitude" | "longitude" | "radiusMiles">;

/**
 * Registers a cohort disabled, which is how every circle past the measured one
 * enters the catalog: visible in `/v1/coverage` and reviewable as a diff before
 * it has made a single upstream request. Enable one with
 * `COLLECTOR_REGION_ALLOWLIST` or `COLLECTOR_MAX_REGION_PRIORITY`.
 */
function awaitingMeasurement(priority: number, circles: Circle[]): SearchCenter[] {
  return circles.map((circle) => ({ ...circle, countryCode: "US", priority, enabled: false }));
}

/**
 * The United States, as circles anchored on the places people play.
 *
 * Every state's largest city and the rural points between them fall inside one
 * of these -- `centers.test.ts` is the assertion, not the prose. The tiers are
 * metropolitan size: the first two are where events actually are, and the third
 * is the fill that makes the coverage national rather than metropolitan.
 */
export const DEFAULT_SEARCH_CENTERS: SearchCenter[] = [
  // Collecting today. Chicago keeps the key and the 100-mile radius its stored
  // events are already filed under; narrowing it would withdraw the outer
  // events it is currently the region of record for.
  { key: "us-il-chicago", name: "Chicago", countryCode: "US", latitude: 41.8781, longitude: -87.6298, radiusMiles: 100, priority: TIER_ONE },
  // One circle for the whole Bay Area rather than the separate San Jose circle
  // the Magic catalog needs: at this source's event density both fit well under
  // the page ceiling, and 75 miles also reaches Santa Rosa and Stockton.
  { key: "us-ca-san-francisco", name: "San Francisco Bay Area", countryCode: "US", latitude: 37.7749, longitude: -122.4194, radiusMiles: 75, priority: TIER_ONE },

  ...awaitingMeasurement(TIER_ONE, [
    { key: "us-ny-new-york", name: "New York", latitude: 40.7128, longitude: -74.0060, radiusMiles: 75 },
    { key: "us-ca-los-angeles", name: "Los Angeles", latitude: 34.0522, longitude: -118.2437, radiusMiles: 75 },
    { key: "us-tx-dallas", name: "Dallas–Fort Worth", latitude: 32.7767, longitude: -96.7970, radiusMiles: 100 },
    { key: "us-tx-houston", name: "Houston", latitude: 29.7604, longitude: -95.3698, radiusMiles: 100 },
    { key: "us-dc-washington", name: "Washington", latitude: 38.9072, longitude: -77.0369, radiusMiles: 75 },
    { key: "us-pa-philadelphia", name: "Philadelphia", latitude: 39.9526, longitude: -75.1652, radiusMiles: 75 },
    { key: "us-fl-miami", name: "Miami", latitude: 25.7617, longitude: -80.1918, radiusMiles: 100 },
    { key: "us-ga-atlanta", name: "Atlanta", latitude: 33.7490, longitude: -84.3880, radiusMiles: 125 },
    { key: "us-ma-boston", name: "Boston", latitude: 42.3601, longitude: -71.0589, radiusMiles: 75 },
    { key: "us-az-phoenix", name: "Phoenix", latitude: 33.4484, longitude: -112.0740, radiusMiles: 125 },
    { key: "us-wa-seattle", name: "Seattle", latitude: 47.6062, longitude: -122.3321, radiusMiles: 125 },
    { key: "us-mi-detroit", name: "Detroit", latitude: 42.3314, longitude: -83.0458, radiusMiles: 100 },
    { key: "us-mn-minneapolis", name: "Minneapolis–Saint Paul", latitude: 44.9778, longitude: -93.2650, radiusMiles: 125 },
  ]),

  ...awaitingMeasurement(TIER_TWO, [
    { key: "us-ca-san-diego", name: "San Diego", latitude: 32.7157, longitude: -117.1611, radiusMiles: 75 },
    { key: "us-co-denver", name: "Denver", latitude: 39.7392, longitude: -104.9903, radiusMiles: 125 },
    { key: "us-fl-tampa", name: "Tampa", latitude: 27.9506, longitude: -82.4572, radiusMiles: 100 },
    { key: "us-fl-orlando", name: "Orlando", latitude: 28.5383, longitude: -81.3792, radiusMiles: 100 },
    { key: "us-mo-st-louis", name: "St. Louis", latitude: 38.6270, longitude: -90.1994, radiusMiles: 125 },
    { key: "us-nc-charlotte", name: "Charlotte", latitude: 35.2271, longitude: -80.8431, radiusMiles: 125 },
    { key: "us-or-portland", name: "Portland, OR", latitude: 45.5152, longitude: -122.6784, radiusMiles: 100 },
    { key: "us-ca-sacramento", name: "Sacramento", latitude: 38.5816, longitude: -121.4944, radiusMiles: 100 },
    { key: "us-nv-las-vegas", name: "Las Vegas", latitude: 36.1699, longitude: -115.1398, radiusMiles: 150 },
    { key: "us-mo-kansas-city", name: "Kansas City", latitude: 39.0997, longitude: -94.5786, radiusMiles: 125 },
    { key: "us-oh-columbus", name: "Columbus", latitude: 39.9612, longitude: -82.9988, radiusMiles: 100 },
    { key: "us-in-indianapolis", name: "Indianapolis", latitude: 39.7684, longitude: -86.1581, radiusMiles: 100 },
    { key: "us-tx-san-antonio", name: "San Antonio", latitude: 29.4241, longitude: -98.4936, radiusMiles: 100 },
    { key: "us-tx-austin", name: "Austin", latitude: 30.2672, longitude: -97.7431, radiusMiles: 75 },
    { key: "us-tn-nashville", name: "Nashville", latitude: 36.1627, longitude: -86.7816, radiusMiles: 125 },
    { key: "us-oh-cleveland", name: "Cleveland", latitude: 41.4993, longitude: -81.6944, radiusMiles: 100 },
    { key: "us-pa-pittsburgh", name: "Pittsburgh", latitude: 40.4406, longitude: -79.9959, radiusMiles: 100 },
    { key: "us-oh-cincinnati", name: "Cincinnati", latitude: 39.1031, longitude: -84.5120, radiusMiles: 100 },
    { key: "us-nc-raleigh", name: "Raleigh", latitude: 35.7796, longitude: -78.6382, radiusMiles: 125 },
    { key: "us-ut-salt-lake-city", name: "Salt Lake City", latitude: 40.7608, longitude: -111.8910, radiusMiles: 150 },
    { key: "us-fl-jacksonville", name: "Jacksonville", latitude: 30.3322, longitude: -81.6557, radiusMiles: 125 },
    { key: "us-tn-memphis", name: "Memphis", latitude: 35.1495, longitude: -90.0490, radiusMiles: 125 },
    { key: "us-ky-louisville", name: "Louisville", latitude: 38.2527, longitude: -85.7585, radiusMiles: 100 },
    { key: "us-va-richmond", name: "Richmond", latitude: 37.5407, longitude: -77.4360, radiusMiles: 125 },
    { key: "us-ok-oklahoma-city", name: "Oklahoma City", latitude: 35.4676, longitude: -97.5164, radiusMiles: 150 },
    { key: "us-la-new-orleans", name: "New Orleans", latitude: 29.9511, longitude: -90.0715, radiusMiles: 125 },
    { key: "us-ct-hartford", name: "Hartford", latitude: 41.7658, longitude: -72.6734, radiusMiles: 75 },
    { key: "us-ny-buffalo", name: "Buffalo", latitude: 42.8864, longitude: -78.8784, radiusMiles: 100 },
    { key: "us-al-birmingham", name: "Birmingham", latitude: 33.5186, longitude: -86.8104, radiusMiles: 125 },
    { key: "us-ca-fresno", name: "Fresno", latitude: 36.7378, longitude: -119.7871, radiusMiles: 100 },
    { key: "us-az-tucson", name: "Tucson", latitude: 32.2226, longitude: -110.9747, radiusMiles: 100 },
    { key: "us-nm-albuquerque", name: "Albuquerque", latitude: 35.0844, longitude: -106.6504, radiusMiles: 150 },
    { key: "us-hi-honolulu", name: "Hawaii", latitude: 21.3069, longitude: -157.8583, radiusMiles: 250 },
    { key: "us-sc-columbia", name: "Columbia", latitude: 34.0007, longitude: -81.0348, radiusMiles: 100 },
    { key: "us-sc-charleston", name: "Charleston, SC", latitude: 32.7765, longitude: -79.9311, radiusMiles: 100 },
    { key: "us-ia-des-moines", name: "Des Moines", latitude: 41.5868, longitude: -93.6250, radiusMiles: 125 },
    { key: "us-ne-omaha", name: "Omaha", latitude: 41.2565, longitude: -95.9345, radiusMiles: 150 },
    { key: "us-wi-madison", name: "Madison", latitude: 43.0731, longitude: -89.4012, radiusMiles: 150 },
    { key: "us-mi-grand-rapids", name: "Grand Rapids", latitude: 42.9634, longitude: -85.6681, radiusMiles: 125 },
    { key: "us-tn-knoxville", name: "Knoxville", latitude: 35.9606, longitude: -83.9207, radiusMiles: 125 },
    { key: "us-ny-albany", name: "Albany", latitude: 42.6526, longitude: -73.7562, radiusMiles: 100 },
    { key: "us-pa-harrisburg", name: "Harrisburg", latitude: 40.2732, longitude: -76.8867, radiusMiles: 125 },
    { key: "us-wa-spokane", name: "Spokane", latitude: 47.6588, longitude: -117.4260, radiusMiles: 150 },
    { key: "us-id-boise", name: "Boise", latitude: 43.6150, longitude: -116.2023, radiusMiles: 150 },
    { key: "us-ar-little-rock", name: "Little Rock", latitude: 34.7465, longitude: -92.2896, radiusMiles: 150 },
    { key: "us-ms-jackson", name: "Jackson", latitude: 32.2988, longitude: -90.1848, radiusMiles: 125 },
    { key: "us-ks-wichita", name: "Wichita", latitude: 37.6872, longitude: -97.3301, radiusMiles: 175 },
  ]),

  // The fill. These are not metros; they are the circles that keep the map from
  // ending at the last metro, and their radii are sized to the emptiness they
  // cover rather than to a city limit.
  ...awaitingMeasurement(TIER_THREE, [
    { key: "us-ca-redding", name: "Redding", latitude: 40.5865, longitude: -122.3917, radiusMiles: 125 },
    { key: "us-or-eugene", name: "Eugene", latitude: 44.0521, longitude: -123.0868, radiusMiles: 150 },
    { key: "us-nv-reno", name: "Reno", latitude: 39.5296, longitude: -119.8138, radiusMiles: 125 },
    { key: "us-nv-elko", name: "Elko", latitude: 40.8324, longitude: -115.7631, radiusMiles: 150 },
    { key: "us-az-flagstaff", name: "Flagstaff", latitude: 35.1983, longitude: -111.6513, radiusMiles: 150 },
    { key: "us-id-idaho-falls", name: "Idaho Falls", latitude: 43.4917, longitude: -112.0339, radiusMiles: 125 },
    { key: "us-mt-missoula", name: "Missoula", latitude: 46.8721, longitude: -113.9940, radiusMiles: 175 },
    { key: "us-mt-billings", name: "Billings", latitude: 45.7833, longitude: -108.5007, radiusMiles: 175 },
    { key: "us-wy-casper", name: "Casper", latitude: 42.8501, longitude: -106.3252, radiusMiles: 175 },
    { key: "us-co-grand-junction", name: "Grand Junction", latitude: 39.0639, longitude: -108.5506, radiusMiles: 150 },
    { key: "us-sd-rapid-city", name: "Rapid City", latitude: 44.0805, longitude: -103.2310, radiusMiles: 175 },
    { key: "us-sd-sioux-falls", name: "Sioux Falls", latitude: 43.5460, longitude: -96.7313, radiusMiles: 150 },
    { key: "us-nd-bismarck", name: "Bismarck", latitude: 46.8083, longitude: -100.7837, radiusMiles: 175 },
    { key: "us-nd-fargo", name: "Fargo", latitude: 46.8772, longitude: -96.7898, radiusMiles: 150 },
    { key: "us-mn-duluth", name: "Duluth", latitude: 46.7867, longitude: -92.1005, radiusMiles: 150 },
    { key: "us-mi-marquette", name: "Marquette", latitude: 46.5436, longitude: -87.3954, radiusMiles: 175 },
    { key: "us-ne-north-platte", name: "North Platte", latitude: 41.1239, longitude: -100.7654, radiusMiles: 150 },
    { key: "us-tx-amarillo", name: "Amarillo", latitude: 35.2220, longitude: -101.8313, radiusMiles: 150 },
    { key: "us-tx-lubbock", name: "Lubbock", latitude: 33.5779, longitude: -101.8552, radiusMiles: 150 },
    { key: "us-tx-midland", name: "Midland–Odessa", latitude: 31.9973, longitude: -102.0779, radiusMiles: 150 },
    { key: "us-tx-el-paso", name: "El Paso", latitude: 31.7619, longitude: -106.4850, radiusMiles: 150 },
    { key: "us-tx-corpus-christi", name: "Corpus Christi", latitude: 27.8006, longitude: -97.3964, radiusMiles: 150 },
    { key: "us-la-shreveport", name: "Shreveport", latitude: 32.5252, longitude: -93.7502, radiusMiles: 125 },
    { key: "us-al-mobile", name: "Mobile", latitude: 30.6954, longitude: -88.0399, radiusMiles: 125 },
    { key: "us-fl-tallahassee", name: "Tallahassee", latitude: 30.4383, longitude: -84.2807, radiusMiles: 125 },
    { key: "us-fl-fort-myers", name: "Fort Myers", latitude: 26.6406, longitude: -81.8723, radiusMiles: 100 },
    { key: "us-fl-key-west", name: "Florida Keys", latitude: 24.5551, longitude: -81.7800, radiusMiles: 75 },
    { key: "us-va-roanoke", name: "Roanoke", latitude: 37.2710, longitude: -79.9414, radiusMiles: 100 },
    { key: "us-wv-charleston", name: "Charleston, WV", latitude: 38.3498, longitude: -81.6326, radiusMiles: 125 },
    { key: "us-ny-syracuse", name: "Syracuse", latitude: 43.0481, longitude: -76.1474, radiusMiles: 100 },
    { key: "us-vt-burlington", name: "Burlington", latitude: 44.4759, longitude: -73.2121, radiusMiles: 100 },
    { key: "us-me-portland", name: "Portland, ME", latitude: 43.6591, longitude: -70.2568, radiusMiles: 125 },
    { key: "us-me-bangor", name: "Bangor", latitude: 44.8016, longitude: -68.7712, radiusMiles: 175 },
    { key: "us-mo-springfield", name: "Springfield, MO", latitude: 37.2090, longitude: -93.2923, radiusMiles: 125 },
    { key: "us-il-springfield", name: "Springfield, IL", latitude: 39.7817, longitude: -89.6501, radiusMiles: 100 },
    { key: "us-ak-anchorage", name: "Anchorage", latitude: 61.2181, longitude: -149.9003, radiusMiles: 250 },
    { key: "us-ak-fairbanks", name: "Fairbanks", latitude: 64.8378, longitude: -147.7164, radiusMiles: 200 },
    { key: "us-ak-juneau", name: "Juneau", latitude: 58.3019, longitude: -134.4197, radiusMiles: 150 },
  ]),
];

function requireFiniteNumber(value: unknown, field: string, index: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`RIFTBOUND_SEARCH_CENTERS_JSON[${index}].${field} must be a finite number`);
  }
  return value;
}

/**
 * Reads an override catalog, rejecting one that would collect nothing.
 *
 * A center whose radius is missing or misspelled -- `radiusMeters`, the key the
 * Magic collector uses -- sends `num_miles=undefined` to a locator that answers
 * it rather than refusing it, which is indistinguishable from a city with no
 * events unless the catalog refuses it here, where the message names the field.
 */
export function parseSearchCenters(value: string): SearchCenter[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`RIFTBOUND_SEARCH_CENTERS_JSON is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("RIFTBOUND_SEARCH_CENTERS_JSON must be a non-empty array");
  }
  return parsed.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`RIFTBOUND_SEARCH_CENTERS_JSON[${index}] must be an object`);
    }
    const center = entry as Record<string, unknown>;
    if (typeof center.name !== "string" || !center.name.trim()) {
      throw new Error(`RIFTBOUND_SEARCH_CENTERS_JSON[${index}].name must be a non-empty string`);
    }
    const latitude = requireFiniteNumber(center.latitude, "latitude", index);
    const longitude = requireFiniteNumber(center.longitude, "longitude", index);
    const radiusMiles = requireFiniteNumber(center.radiusMiles, "radiusMiles", index);
    if (latitude < -90 || latitude > 90) {
      throw new Error(`RIFTBOUND_SEARCH_CENTERS_JSON[${index}].latitude must be between -90 and 90`);
    }
    if (longitude < -180 || longitude > 180) {
      throw new Error(`RIFTBOUND_SEARCH_CENTERS_JSON[${index}].longitude must be between -180 and 180`);
    }
    if (radiusMiles <= 0) {
      throw new Error(`RIFTBOUND_SEARCH_CENTERS_JSON[${index}].radiusMiles must be greater than zero`);
    }
    return { ...center, name: center.name, latitude, longitude, radiusMiles } as SearchCenter;
  });
}

export function getSearchCenters(): SearchCenter[] {
  const configured = process.env.RIFTBOUND_SEARCH_CENTERS_JSON;
  return configured ? parseSearchCenters(configured) : DEFAULT_SEARCH_CENTERS;
}
