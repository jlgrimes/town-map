import { describe, expect, it } from "vitest";
import type { EventListItem } from "@town-map/contracts";
import {
  FIRST_PAINT_PLACE_ASK,
  discoverDateWindow,
  discoverFirstPaint,
  discoverResultsPaint,
  initialDateFilter,
  initialTab,
  matchesDate,
  matchesPrice,
  shouldAutoLocateOnFirstLoad,
} from "./town-map-model";

function event(overrides: Partial<EventListItem> = {}): EventListItem {
  return {
    id: "event-1",
    source: "wotc-locator",
    sourceEventId: "event-1",
    game: "magic",
    title: "Local",
    description: null,
    startsAt: new Date().toISOString(),
    endsAt: null,
    timezone: "America/Chicago",
    status: "scheduled",
    format: null,
    eventType: "Local",
    series: null,
    sourceUrl: "https://example.com/events/demo",
    registrationUrl: null,
    priceAmount: null,
    priceCurrency: "USD",
    capacity: null,
    isOnline: false,
    distanceMiles: 1,
    venue: null,
    ...overrides,
  };
}

function localIso(daysFromToday: number, hour: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

describe("Discover live path defaults", () => {
  it("opens on Discover, not My events", () => {
    expect(initialTab(new URLSearchParams())).toBe("discover");
  });

  it("defaults the dated window to all so Eventbrite chips own the time slice", () => {
    expect(initialDateFilter(new URLSearchParams())).toBe("all");
  });

  it("keeps tonight and drops tomorrow when the window is today", () => {
    const tonight = event({ id: "tonight", startsAt: localIso(0, 19) });
    const tomorrow = event({ id: "tomorrow", startsAt: localIso(1, 19) });
    expect(matchesDate(tonight, "today")).toBe(true);
    expect(matchesDate(tomorrow, "today")).toBe(false);
  });

  it("does not treat a missing price as free", () => {
    expect(matchesPrice(event({ priceAmount: null }), "free")).toBe(false);
    expect(matchesPrice(event({ priceAmount: 0 }), "free")).toBe(true);
  });
});

describe("first load location", () => {
  it("does not auto-prompt GPS, so a denied prompt cannot become the default screen", () => {
    expect(shouldAutoLocateOnFirstLoad()).toBe(false);
  });

  it("first load without a place is the city/ZIP ask, not an empty map", () => {
    expect(discoverFirstPaint(false)).toBe("place-ask");
    expect(discoverFirstPaint(true)).toBe("map");
    expect(FIRST_PAINT_PLACE_ASK.title).toMatch(/where should we look/i);
    expect(FIRST_PAINT_PLACE_ASK.description).toMatch(/city.+ZIP/i);
  });
  it("a chosen place with no matching events is the truth empty, not a blank map", () => {
    expect(discoverResultsPaint({ status: "live", visibleCount: 0 })).toBe("empty");
    expect(discoverResultsPaint({ status: "error", visibleCount: 0 })).toBe("empty");
    expect(discoverResultsPaint({ status: "loading", visibleCount: 0 })).toBe("map-list");
    expect(discoverResultsPaint({ status: "live", visibleCount: 3 })).toBe("map-list");
  });

  it("widens the client date window after a place is chosen so This weekend is not empty", () => {
    expect(discoverDateWindow("today", false)).toBe("today");
    expect(discoverDateWindow("today", true)).toBe("all");
    expect(discoverDateWindow("week", true)).toBe("week");
  });
});
