/**
 * Bandai honors `limit` up to at least 1000 (probed 2026-08-20).
 * A US-wide collect is ~30k events. Page size 100 needed 300 pages;
 * page size 1000 finishes in 31.
 */
export const ONEPIECE_PAGE_SIZE = 1000;
export const US_ONEPIECE_EVENTS = 31_000;
export const MIN_ONEPIECE_MAX_PAGES = Math.ceil(US_ONEPIECE_EVENTS / ONEPIECE_PAGE_SIZE);
export const DEFAULT_ONEPIECE_MAX_PAGES = MIN_ONEPIECE_MAX_PAGES;

export function onePieceMaxPages(env: NodeJS.ProcessEnv = process.env) {
  const parsed = Number(env.ONEPIECE_MAX_PAGES ?? DEFAULT_ONEPIECE_MAX_PAGES);
  const requested = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ONEPIECE_MAX_PAGES;
  return Math.max(requested, MIN_ONEPIECE_MAX_PAGES);
}

export function onePieceMaxEvents(env: NodeJS.ProcessEnv = process.env) {
  return ONEPIECE_PAGE_SIZE * onePieceMaxPages(env);
}
