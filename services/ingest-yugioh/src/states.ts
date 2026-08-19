/**
 * The United States subdivisions the KCGN endpoint is asked about.
 *
 * The endpoint filters by state code, so a state nobody asks about is a state
 * with no events rather than an error, and coverage is exactly this list. It
 * lives in the repository for the same reason the Magic circle catalog does:
 * where Town Map claims coverage should arrive as a diff, not as an
 * environment variable nobody reviews.
 *
 * Non-US coverage is a different question. This endpoint is the US one, and
 * `docs/global-coverage.md` keeps other countries behind verified
 * country-specific interfaces rather than guessing at this one's parameters.
 */
export type StateRegion = {
  code: string;
  priority?: number;
  enabled?: boolean;
};

/** Rollout tiers, lowest first. `claimNextCollectionRegion` orders by priority. */
const TIER_ONE = 10;
const TIER_TWO = 20;
const TIER_THREE = 30;

/**
 * Every state and the District of Columbia, tiered by population.
 *
 * Registered disabled apart from the measured cohort, so the catalog can be
 * reviewed and its per-state yield sampled before it reaches upstream. Enable a
 * cohort with `COLLECTOR_REGION_ALLOWLIST` or `COLLECTOR_MAX_REGION_PRIORITY`.
 */
export const DEFAULT_STATES: StateRegion[] = [
  // Collecting today. Illinois keeps the code its stored events are filed
  // under; California is the cohort this catalog was opened for.
  { code: "IL", priority: TIER_ONE },
  { code: "CA", priority: TIER_ONE },

  // National catalog, collecting.
  ...["TX", "FL", "NY", "PA", "OH", "GA", "NC", "MI"]
    .map((code) => ({ code, priority: TIER_ONE })),
  ...["NJ", "VA", "WA", "AZ", "TN", "MA", "IN", "MO", "MD", "WI", "CO", "MN", "SC", "AL", "LA"]
    .map((code) => ({ code, priority: TIER_TWO })),
  ...[
    "KY", "OR", "OK", "CT", "UT", "IA", "NV", "AR", "MS", "KS", "NM", "NE", "ID",
    "WV", "HI", "NH", "ME", "MT", "RI", "DE", "SD", "ND", "AK", "DC", "VT", "WY",
  ].map((code) => ({ code, priority: TIER_THREE })),
];

const KNOWN_CODES = new Set(DEFAULT_STATES.map((state) => state.code));

/**
 * Reads a state override, rejecting a code the endpoint cannot filter on.
 *
 * KCGN answers an unrecognised state with an empty result rather than an
 * error, so a typo used to register a region that reported success and
 * collected nothing for as long as it stayed configured.
 */
export function parseStates(value: string): StateRegion[] {
  const codes = value.split(",").map((state) => state.trim().toUpperCase()).filter(Boolean);
  if (!codes.length) throw new Error("YUGIOH_STATES must name at least one state");
  const unknown = codes.filter((code) => !KNOWN_CODES.has(code));
  if (unknown.length) {
    throw new Error(`YUGIOH_STATES contains unknown state code(s): ${unknown.join(", ")}`);
  }
  return [...new Set(codes)].map((code) => ({ code }));
}

export function getStates(): StateRegion[] {
  const configured = process.env.YUGIOH_STATES;
  return configured ? parseStates(configured) : DEFAULT_STATES;
}
