/**
 * Bandai TCG+ regions Town Map collects.
 *
 * Coverage is this list, not `ONEPIECE_REGIONS_JSON`. A leftover env pin
 * used to replace the catalog and leave production on Illinois after the git
 * catalog went national. Stage with `COLLECTOR_REGION_ALLOWLIST` if you must
 * shrink it.
 *
 * The list endpoint filters by `country_code[]` and optional `pref_code[]`.
 * Omitting pref codes collects the whole country in one job instead of 51
 * state round-trips against the same API.
 */
export type OnePieceRegion = {
  key?: string;
  name: string;
  countryCode: string;
  prefCodes?: string[];
  cadenceMinutes?: number;
  priority?: number;
  enabled?: boolean;
};

export const DEFAULT_REGIONS: OnePieceRegion[] = [
  {
    key: "US",
    name: "United States",
    countryCode: "US",
    priority: 10,
  },
];

export function getRegions(): OnePieceRegion[] {
  return DEFAULT_REGIONS;
}
