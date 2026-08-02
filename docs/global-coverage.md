# Global event coverage rollout

“Every event in the world” is a product direction, not a claim the current upstream sources can guarantee. Town Map should describe coverage precisely: which games, sources, countries or search regions are enabled; when each region last succeeded; and which event categories each source actually contains.

## Current source boundaries

| Game | Current source | Geographic behavior | Main limitation |
| --- | --- | --- | --- |
| Magic | Wizards Store and Event Locator | Coordinate-and-radius search regions | Worldwide coverage needs a bounded, overlapping search-center catalog and an agreed request budget |
| Yu-Gi-Oh! | KONAMI Card Game Network | State search through the US endpoint | Other countries require verified country-specific endpoints or an official feed |
| Pokémon | Pokedata event export | Worldwide or country-filtered competitive TCG export | Third-party data is not authoritative and excludes unsupported event categories |
| One Piece | Bandai TCG+ | Country and subdivision regions | Production automation needs written Bandai authorization; high event volume requires bounded regional paging |
| Riftbound | Official Riftbound locator | Coordinate-and-radius search regions | Production automation needs written UVS/Riot authorization; worldwide coverage requires a bounded center catalog |

The existing production defaults stay intentionally small. Catalog growth and activation are separate operations: regions may be registered as disabled so coverage can be reviewed before any upstream request is made.

## Rollout controls

- `COLLECTOR_ENABLED=false` disables every region for one service while preserving its catalog and historical events.
- `COLLECTOR_REGION_ALLOWLIST=key-one,key-two` enables only named regions. An explicitly empty value disables all regions.
- `COLLECTOR_MAX_REGION_PRIORITY=20` enables definitions at or above the current rollout importance, where lower numeric priority runs first.
- `COLLECTOR_JOB_LIMIT` bounds the number of due regions handled by one scheduled container.
- `COLLECTOR_REGION_CADENCE_MINUTES` controls the default refresh interval; individual Magic centers may override it.

Configuration is authoritative. A definition removed from the deployed catalog is disabled in PostgreSQL rather than deleted.

## Coverage states

`GET /v1/coverage` returns source totals and sanitized regional state:

- `pending`: enabled but has never completed successfully.
- `running`: currently has a valid worker lease.
- `fresh`: completed within twice its configured cadence.
- `stale`: has not completed within twice its configured cadence.
- `failing`: its latest attempt failed after its latest success.
- `disabled`: visible in the catalog but ineligible for collection.

The response intentionally omits source request configuration, lease-owner identifiers, and raw upstream errors.

## Expansion gates

A new source or region cohort should not be activated until all of these are true:

1. The source’s terms and permission posture are documented.
2. A conservative request budget, timeout, retry policy, and identifying user agent are set.
3. Stable event and venue identifiers are verified so overlap remains idempotent.
4. Empty, malformed, partial, or rate-limited responses fail closed without deleting prior data.
5. Timezone conversion and coordinate quality are sampled across the cohort.
6. The cohort runs in dry-run mode, then as a small allowlist, before broader activation.
7. Freshness, failure rate, event yield, duplicate rate, and runtime stay within the agreed thresholds for at least one week.

Suggested initial thresholds are at least 99% successful regional runs, no region beyond twice its cadence, less than 1% normalization rejection, and no sustained HTTP 429 responses.

## Recommended sequence

1. Observe the existing Chicago Magic/Riftbound, Illinois Yu-Gi-Oh!/One Piece, and Pokémon regions through `/v1/coverage`.
2. Build a disabled Magic metropolitan catalog, deduplicating overlapping results by the existing source event ID.
3. Activate five Magic metros with the allowlist and measure event yield per request for one week.
4. Expand Yu-Gi-Oh! across US states in small priority cohorts; investigate official non-US interfaces separately.
5. Compare country-filtered Pokémon exports with the worldwide export before deciding whether country partitioning improves reliability.
6. Secure written permission before enabling the Bandai TCG+ and Riftbound collectors in production.
7. Add first-party or partner feeds where locator interfaces cannot provide defensible coverage.
8. Publish user-facing coverage language based on measured regions and source categories, never an unqualified “all events” claim.
