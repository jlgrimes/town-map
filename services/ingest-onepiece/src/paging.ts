/**
 * Bandai TCG+ list pagination. Live US catalog is ~30k events in the
 * 90-day window. The old defaults (page size 100, max 100 pages) capped
 * out at 10k and threw ONEPIECE_MAX_PAGES after ~15 minutes.
 *
 * Bandai honors `limit` up to at least 1000 (probed 2026-08-20). 50 pages
 * of 1000 covers 50k events, so one US collect can finish without splitting
 * into 51 state jobs.
 */
export const DEFAULT_ONEPIECE_PAGE_SIZE = 1000;
export const DEFAULT_ONEPIECE_MAX_PAGES = 50;
