import type { EventListItem, Game } from "@town-map/contracts";
import { matchesFormat, type FormatFilter } from "@/components/filters/format-pills";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const EVENING_START_HOUR = 16;
const EVENING_END_HOUR = 23;
const FORMAT_MISS = 0.35;
const DAY_PART_OFF = 0.75;
const CADENCE_WEEKLY = 1;
const CADENCE_OTHER = 0.9;
const CADENCE_NONE = 0.8;

export type HomeChip = "all" | "for-you" | "today" | "this-weekend";

export const HOME_CHIPS: Array<{ value: HomeChip; label: string }> = [
  { value: "all", label: "All" },
  { value: "for-you", label: "For you" },
  { value: "today", label: "Today" },
  { value: "this-weekend", label: "This weekend" },
];

export const DEFAULT_HOME_CHIP: HomeChip = "for-you";

export const CAROUSEL_LIMIT = 12;

export const CAROUSEL_HEADINGS = [
  "For you",
  "Starting soon",
  "Nearby",
  "Repeats weekly",
] as const;

export type RankContext = {
  now: Date;
  selectedGames: Game[];
  formatFilter: FormatFilter;
};

export type PrefsContext = Pick<RankContext, "selectedGames" | "formatFilter">;

/** Empty games + All formats is not personalization. For you stays hidden. */
export function hasSavedPrefs(prefs: PrefsContext): boolean {
  return prefs.selectedGames.length > 0 || prefs.formatFilter !== "all";
}

export function homeChipsFor(prefs: PrefsContext) {
  if (hasSavedPrefs(prefs)) return HOME_CHIPS;
  return HOME_CHIPS.filter((chip) => chip.value !== "for-you");
}

export function defaultHomeChipFor(prefs: PrefsContext): HomeChip {
  return hasSavedPrefs(prefs) ? "for-you" : "all";
}

/** Empty Today/weekend copy. Never names For you when that chip is hidden. */
export function chipWindowEmptyCopy(forYouVisible: boolean): string {
  return forYouVisible
    ? "Nothing in this window. Try All or For you."
    : "Nothing in this window. Try All.";
}

export type EventCarousel = {
  key: "for-you" | "starting-soon" | "nearby" | "repeats-weekly";
  heading: (typeof CAROUSEL_HEADINGS)[number];
  events: EventListItem[];
};

/** Missing startsAt-like data never zeros a row. Within 6h is 1; ~0.4 at 7 days. */
export function startsSoonFactor(startsAt: string, now: Date): number {
  const start = Date.parse(startsAt);
  if (!Number.isFinite(start)) return 1;
  const delta = start - now.getTime();
  if (delta <= SIX_HOURS_MS) return 1;
  const span = SEVEN_DAYS_MS - SIX_HOURS_MS;
  const t = (delta - SIX_HOURS_MS) / span;
  return Math.exp(Math.log(0.4) * t);
}

/** 1 at 0 mi, ~0.5 at 25 mi, ~0.2 at 100 mi. Null distance is 1. */
export function distanceFactor(distanceMiles: number | null): number {
  if (distanceMiles == null || !Number.isFinite(distanceMiles)) return 1;
  return 1 / (1 + distanceMiles / 25);
}

/**
 * 1 if no game pick or the event's game is selected. A Magic format chip
 * that is not All scores 1 on a match and ~0.35 otherwise.
 */
export function gameFormatFactor(event: EventListItem, ctx: RankContext): number {
  const gameOk = ctx.selectedGames.length === 0 || ctx.selectedGames.includes(event.game);
  if (!gameOk) return FORMAT_MISS;
  if (ctx.formatFilter === "all") return 1;
  return matchesFormat(event.format, ctx.formatFilter) ? 1 : FORMAT_MISS;
}

/** 1 for local hour 16–23, else ~0.75. Unparseable start is 1. */
export function dayPartFactor(startsAt: string): number {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return 1;
  const hour = start.getHours();
  return hour >= EVENING_START_HOUR && hour <= EVENING_END_HOUR ? 1 : DAY_PART_OFF;
}

/** Weekly series 1.0, other positive cadence 0.9, no series 0.8, null cadence 1. */
export function cadenceFactor(series: EventListItem["series"]): number {
  if (!series) return CADENCE_NONE;
  const days = series.cadenceDays;
  if (days == null) return 1;
  if (days === 7) return CADENCE_WEEKLY;
  if (days > 0) return CADENCE_OTHER;
  return 1;
}

export function scoreEvent(event: EventListItem, ctx: RankContext): number {
  return (
    startsSoonFactor(event.startsAt, ctx.now) *
    distanceFactor(event.distanceMiles) *
    gameFormatFactor(event, ctx) *
    dayPartFactor(event.startsAt) *
    cadenceFactor(event.series)
  );
}

export function rankEvents(events: EventListItem[], ctx: RankContext): EventListItem[] {
  return [...events].sort((a, b) => {
    const diff = scoreEvent(b, ctx) - scoreEvent(a, ctx);
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startsTodayLocal(startsAt: string, now: Date): boolean {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return false;
  return start.toDateString() === now.toDateString();
}

/**
 * Fri–Sun containing today when today is Fri/Sat/Sun; otherwise the upcoming Fri–Sun.
 */
export function weekendWindow(now: Date): { start: Date; end: Date } {
  const day = now.getDay();
  const today = startOfLocalDay(now);
  const friday = new Date(today);
  if (day === 0) friday.setDate(today.getDate() - 2);
  else if (day === 5 || day === 6) friday.setDate(today.getDate() - (day - 5));
  else friday.setDate(today.getDate() + (5 - day));
  const monday = new Date(friday);
  monday.setDate(friday.getDate() + 3);
  return { start: friday, end: monday };
}

export function startsThisWeekend(startsAt: string, now: Date): boolean {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return false;
  const { start: friday, end: monday } = weekendWindow(now);
  return start >= friday && start < monday;
}

export function sliceByHomeChip(
  ranked: EventListItem[],
  chip: HomeChip,
  now: Date,
): EventListItem[] {
  if (chip === "all" || chip === "for-you") return ranked;
  if (chip === "today") return ranked.filter((event) => startsTodayLocal(event.startsAt, now));
  return ranked.filter((event) => startsThisWeekend(event.startsAt, now));
}

/**
 * All ignores saved games and formats. For you (and the time chips) rank with
 * them, so For you is not All with a different label.
 */
export function rankForChip(
  events: EventListItem[],
  chip: HomeChip,
  ctx: RankContext,
): EventListItem[] {
  const rankCtx: RankContext = chip === "all"
    ? { ...ctx, selectedGames: [], formatFilter: "all" }
    : ctx;
  return sliceByHomeChip(rankEvents(events, rankCtx), chip, ctx.now);
}

function bySoonestStart(a: EventListItem, b: EventListItem): number {
  const diff = Date.parse(a.startsAt) - Date.parse(b.startsAt);
  if (diff !== 0) return diff;
  return a.id.localeCompare(b.id);
}

function byClosest(a: EventListItem, b: EventListItem): number {
  const da = a.distanceMiles ?? Number.POSITIVE_INFINITY;
  const db = b.distanceMiles ?? Number.POSITIVE_INFINITY;
  if (da !== db) return da - db;
  return a.id.localeCompare(b.id);
}

export function buildCarousels(
  sliced: EventListItem[],
  options: { forYou?: boolean } = {},
): EventCarousel[] {
  const forYou = sliced.slice(0, CAROUSEL_LIMIT);
  const startingSoon = [...sliced].sort(bySoonestStart).slice(0, CAROUSEL_LIMIT);
  const nearby = [...sliced].sort(byClosest).slice(0, CAROUSEL_LIMIT);
  const weekly = sliced
    .filter((event) => event.series?.cadenceDays === 7)
    .slice(0, CAROUSEL_LIMIT);

  const rows: EventCarousel[] = [
    ...(options.forYou === false ? [] : [{ key: "for-you" as const, heading: "For you" as const, events: forYou }]),
    { key: "starting-soon", heading: "Starting soon", events: startingSoon },
    { key: "nearby", heading: "Nearby", events: nearby },
    { key: "repeats-weekly", heading: "Repeats weekly", events: weekly },
  ];
  return rows.filter((carousel) => carousel.events.length > 0);
}

export function registrationHref(event: EventListItem): string | null {
  return event.registrationUrl || event.sourceUrl || null;
}
