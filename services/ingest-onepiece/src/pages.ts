/**
 * Bandai pages 100 events at a time. A US-wide collect is ~30k events.
 * The old default of 100 pages capped at 10k and threw mid-collect.
 */
export const ONEPIECE_PAGE_SIZE = 100;
export const US_ONEPIECE_EVENTS = 30_000;
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
