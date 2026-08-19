import { type EventListItem, type Game } from "@town-map/contracts";
import { dateLabel } from "@/components/ui/event-row";
import {
  DATE_OPTIONS,
  DEFAULT_RADIUS_MILES,
  PRICE_OPTIONS,
  type DateFilter,
  type PriceFilter,
} from "@/components/filters/filter-bar";

export const PAGE_SIZE = 24;

export type Tab = "my-events" | "discover" | "preferences";

export type AppAuth = {
  enabled: boolean;
  loaded: boolean;
  signedIn: boolean;
  getToken: () => Promise<string | null>;
};

export const guestAuth: AppAuth = {
  enabled: false,
  loaded: true,
  signedIn: false,
  getToken: async () => null,
};

export const SAVED_SECTIONS = [
  { key: "upcoming", heading: "Upcoming" },
  { key: "past", heading: "Past" },
] as const;

const DATE_WINDOW_DAYS: Record<"today" | "3days" | "week" | "month", number> = {
  today: 1,
  "3days": 3,
  week: 7,
  month: 30,
};

export function initialGames(params: URLSearchParams): Game[] | null {
  const rawGames = params.get("games");
  if (rawGames === null) return null;
  return rawGames.split(",").filter(Boolean);
}

export function initialDateFilter(params: URLSearchParams): DateFilter {
  const value = params.get("date");
  return DATE_OPTIONS.some((option) => option.value === value) ? value as DateFilter : "today";
}

export function initialPriceFilter(params: URLSearchParams): PriceFilter {
  const value = params.get("price");
  return PRICE_OPTIONS.some((option) => option.value === value) ? value as PriceFilter : "all";
}

export function initialTab(params: URLSearchParams): Tab {
  const value = params.get("tab");
  if (value === "preferences") return "preferences";
  if (value === "my-events") return "my-events";
  return "discover";
}

export function initialNumber(params: URLSearchParams, name: string, fallback: number) {
  const rawValue = params.get(name);
  if (rawValue === null || rawValue.trim() === "") return fallback;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : fallback;
}

export function sortEvents(events: EventListItem[]) {
  return [...events].sort((a, b) => {
    const dateDifference = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
    const distanceDifference = (a.distanceMiles ?? Number.POSITIVE_INFINITY) - (b.distanceMiles ?? Number.POSITIVE_INFINITY);
    return dateDifference || distanceDifference || a.title.localeCompare(b.title);
  });
}

function eventDateKey(dateString: string) {
  const date = new Date(dateString);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function groupEventsByDate(events: EventListItem[]) {
  const groups: Array<{ key: string; label: string; events: EventListItem[] }> = [];
  for (const event of events) {
    const key = eventDateKey(event.startsAt);
    const current = groups.at(-1);
    if (current?.key === key) current.events.push(event);
    else groups.push({ key, label: dateLabel(event.startsAt), events: [event] });
  }
  return groups;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(date.getDate() + days);
  return next;
}

export function matchesDate(event: EventListItem, filter: DateFilter) {
  if (filter === "all") return true;
  const eventDate = new Date(event.startsAt);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (filter === "tomorrow") {
    const startOfTomorrow = addDays(startOfToday, 1);
    return eventDate >= startOfTomorrow && eventDate < addDays(startOfTomorrow, 1);
  }
  return eventDate >= startOfToday && eventDate < addDays(startOfToday, DATE_WINDOW_DAYS[filter]);
}

export function matchesPrice(event: EventListItem, filter: PriceFilter) {
  if (filter === "all") return true;
  if (event.priceAmount === null) return false;
  if (filter === "free") return event.priceAmount === 0;
  if (filter === "under10") return event.priceAmount < 10;
  return event.priceAmount < 25;
}

export { DEFAULT_RADIUS_MILES };
export type { DateFilter, PriceFilter, Game };
