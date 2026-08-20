/**
 * The United States subdivisions the KCGN endpoint is asked about.
 *
 * Coverage is this list, not `YUGIOH_STATES`. A leftover env pin used to
 * replace the catalog and leave production on Illinois after the git catalog
 * went national. Stage with `COLLECTOR_REGION_ALLOWLIST` if you must shrink it.
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

/** Every state and the District of Columbia, tiered by population. All enabled. */
export const DEFAULT_STATES: StateRegion[] = [
  { code: "IL", priority: TIER_ONE },
  { code: "CA", priority: TIER_ONE },
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
 * Reads a state list, rejecting a code the endpoint cannot filter on.
 *
 * Kept for tests. Production coverage is `DEFAULT_STATES` even when
 * `YUGIOH_STATES` is still set on the collector service.
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
  return DEFAULT_STATES;
}
