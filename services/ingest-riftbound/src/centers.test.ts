import { describe, expect, it } from "vitest";
import { DEFAULT_SEARCH_CENTERS, parseSearchCenters } from "./centers.js";

const EARTH_RADIUS_MILES = 3958.7613;

function milesBetween(aLat: number, aLon: number, bLat: number, bLon: number) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const lat1 = toRadians(aLat);
  const lat2 = toRadians(bLat);
  const halfLat = Math.sin(toRadians(bLat - aLat) / 2) ** 2;
  const halfLon = Math.sin(toRadians(bLon - aLon) / 2) ** 2;
  const a = halfLat + Math.cos(lat1) * Math.cos(lat2) * halfLon;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a));
}

function coveringCircle(latitude: number, longitude: number) {
  return DEFAULT_SEARCH_CENTERS.find(
    (center) => milesBetween(latitude, longitude, center.latitude, center.longitude) <= center.radiusMiles,
  );
}

/** The largest city in each state and the District of Columbia. */
const LARGEST_CITIES: Array<[string, number, number]> = [
  ["AL Birmingham", 33.5186, -86.8104], ["AK Anchorage", 61.2181, -149.9003],
  ["AZ Phoenix", 33.4484, -112.0740], ["AR Little Rock", 34.7465, -92.2896],
  ["CA Los Angeles", 34.0522, -118.2437], ["CO Denver", 39.7392, -104.9903],
  ["CT Bridgeport", 41.1792, -73.1894], ["DE Wilmington", 39.7459, -75.5466],
  ["DC Washington", 38.9072, -77.0369], ["FL Jacksonville", 30.3322, -81.6557],
  ["GA Atlanta", 33.7490, -84.3880], ["HI Honolulu", 21.3069, -157.8583],
  ["ID Boise", 43.6150, -116.2023], ["IL Chicago", 41.8781, -87.6298],
  ["IN Indianapolis", 39.7684, -86.1581], ["IA Des Moines", 41.5868, -93.6250],
  ["KS Wichita", 37.6872, -97.3301], ["KY Louisville", 38.2527, -85.7585],
  ["LA New Orleans", 29.9511, -90.0715], ["ME Portland", 43.6591, -70.2568],
  ["MD Baltimore", 39.2904, -76.6122], ["MA Boston", 42.3601, -71.0589],
  ["MI Detroit", 42.3314, -83.0458], ["MN Minneapolis", 44.9778, -93.2650],
  ["MS Jackson", 32.2988, -90.1848], ["MO Kansas City", 39.0997, -94.5786],
  ["MT Billings", 45.7833, -108.5007], ["NE Omaha", 41.2565, -95.9345],
  ["NV Las Vegas", 36.1699, -115.1398], ["NH Manchester", 42.9956, -71.4548],
  ["NJ Newark", 40.7357, -74.1724], ["NM Albuquerque", 35.0844, -106.6504],
  ["NY New York", 40.7128, -74.0060], ["NC Charlotte", 35.2271, -80.8431],
  ["ND Fargo", 46.8772, -96.7898], ["OH Columbus", 39.9612, -82.9988],
  ["OK Oklahoma City", 35.4676, -97.5164], ["OR Portland", 45.5152, -122.6784],
  ["PA Philadelphia", 39.9526, -75.1652], ["RI Providence", 41.8240, -71.4128],
  ["SC Charleston", 32.7765, -79.9311], ["SD Sioux Falls", 43.5460, -96.7313],
  ["TN Nashville", 36.1627, -86.7816], ["TX Houston", 29.7604, -95.3698],
  ["UT Salt Lake City", 40.7608, -111.8910], ["VT Burlington", 44.4759, -73.2121],
  ["VA Virginia Beach", 36.8529, -75.9780], ["WA Seattle", 47.6062, -122.3321],
  ["WV Charleston", 38.3498, -81.6326], ["WI Milwaukee", 43.0389, -87.9065],
  ["WY Cheyenne", 41.1400, -104.8202],
];

/**
 * Towns far from any metro this catalog is anchored on.
 *
 * The tier-one and tier-two circles alone would cover the country's population
 * and still miss most of its area, and a player in Presque Isle searching a map
 * that claims national coverage gets an empty result rather than an
 * explanation. These are what the fill tier exists for.
 */
const REACH_POINTS: Array<[string, number, number]> = [
  ["ME Presque Isle", 46.6811, -68.0159], ["MI Traverse City", 44.7631, -85.6206],
  ["OR Medford", 42.3265, -122.8756], ["AZ Flagstaff", 35.1983, -111.6513],
  ["TX McAllen", 26.2034, -98.2300], ["FL Key West", 24.5551, -81.7800],
  ["MT Great Falls", 47.5002, -111.3008], ["UT St. George", 37.0965, -113.5684],
  ["HI Hilo", 19.7297, -155.0900], ["AK Fairbanks", 64.8378, -147.7164],
  ["NY Watertown", 43.9748, -75.9108], ["KS Dodge City", 37.7528, -100.0171],
  ["WY Jackson", 43.4799, -110.7624], ["CA Eureka", 40.8021, -124.1637],
  ["NV Elko", 40.8324, -115.7631], ["MN Bemidji", 47.4736, -94.8803],
  ["GA Valdosta", 30.8327, -83.2785], ["VA Bristol", 36.5951, -82.1885],
  ["NC Wilmington", 34.2257, -77.9447], ["WI Green Bay", 44.5133, -88.0158],
  ["IA Davenport", 41.5236, -90.5776], ["ID Coeur d'Alene", 47.6777, -116.7805],
  ["PA Scranton", 41.4090, -75.6624], ["CO Durango", 37.2753, -107.8801],
  ["NE Scottsbluff", 41.8666, -103.6672], ["LA Lafayette", 30.2241, -92.0198],
  ["IL Carbondale", 37.7273, -89.2168], ["ND Williston", 48.1470, -103.6180],
  ["SD Pierre", 44.3683, -100.3510],
];

describe("DEFAULT_SEARCH_CENTERS", () => {
  it("keeps the region key Chicago's stored events are already filed under", () => {
    const chicago = DEFAULT_SEARCH_CENTERS.find((center) => center.key === "us-il-chicago");
    expect(chicago).toMatchObject({ radiusMiles: 100, latitude: 41.8781, longitude: -87.6298 });
    expect(chicago?.enabled).not.toBe(false);
  });

  it("registers the catalog beyond the measured cohort as disabled", () => {
    const enabled = DEFAULT_SEARCH_CENTERS.filter((center) => center.enabled !== false);
    expect(enabled.map((center) => center.key)).toEqual(["us-il-chicago", "us-ca-san-francisco"]);
  });

  it("gives every center a unique key and a usable circle", () => {
    const keys = DEFAULT_SEARCH_CENTERS.map((center) => center.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const center of DEFAULT_SEARCH_CENTERS) {
      expect(center.key).toMatch(/^us-[a-z]{2}-[a-z-]+$/);
      expect(center.countryCode).toBe("US");
      expect(Math.abs(center.latitude)).toBeLessThanOrEqual(90);
      expect(Math.abs(center.longitude)).toBeLessThanOrEqual(180);
      expect(center.radiusMiles).toBeGreaterThan(0);
    }
  });

  it.each(LARGEST_CITIES)("covers %s", (_city, latitude, longitude) => {
    expect(coveringCircle(latitude, longitude)).toBeDefined();
  });

  it.each(REACH_POINTS)("reaches %s", (_town, latitude, longitude) => {
    expect(coveringCircle(latitude, longitude)).toBeDefined();
  });
});

describe("parseSearchCenters", () => {
  const valid = '[{"name":"San Francisco","latitude":37.7749,"longitude":-122.4194,"radiusMiles":75}]';

  it("accepts a well-formed catalog", () => {
    expect(parseSearchCenters(valid)).toEqual([
      { name: "San Francisco", latitude: 37.7749, longitude: -122.4194, radiusMiles: 75 },
    ]);
  });

  // The Magic collector's centers use radiusMeters, and copying that shape sent
  // num_miles=undefined -- a circle the locator answers with something other
  // than the requested area, which reads as a city with a strange event count
  // rather than as a misconfiguration.
  it("names the field when a radius is missing", () => {
    const configured = '[{"name":"San Francisco","latitude":37.7749,"longitude":-122.4194,"radiusMeters":50000}]';
    expect(() => parseSearchCenters(configured)).toThrow(/radiusMiles must be a finite number/);
  });

  it.each([
    ["[]", /non-empty array/],
    ['{"name":"San Francisco"}', /non-empty array/],
    ["not json", /not valid JSON/],
    ['[{"latitude":37.7,"longitude":-122.4,"radiusMiles":75}]', /name must be a non-empty string/],
    ['[{"name":"X","latitude":"37.7","longitude":-122.4,"radiusMiles":75}]', /latitude must be a finite number/],
    ['[{"name":"X","latitude":91,"longitude":-122.4,"radiusMiles":75}]', /latitude must be between/],
    ['[{"name":"X","latitude":37.7,"longitude":-181,"radiusMiles":75}]', /longitude must be between/],
    ['[{"name":"X","latitude":37.7,"longitude":-122.4,"radiusMiles":0}]', /radiusMiles must be greater than zero/],
  ])("rejects %s", (configured, message) => {
    expect(() => parseSearchCenters(configured)).toThrow(message);
  });
});
