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
 * costs fill circles rather than a grid of small ones.
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

/** Attaches a rollout tier. Every circle in the catalog collects. */
function withPriority(priority: number, circles: Circle[]): SearchCenter[] {
  return circles.map((circle) => ({ ...circle, countryCode: "US", priority }));
}
