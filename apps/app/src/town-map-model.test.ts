import { describe, expect, it } from "vitest";
import type { EventListItem } from "@town-map/contracts";
import {
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

  it("defaults the dated window to today so Tonight is the product path", () => {
    expect(initialDateFilter(new URLSearchParams())).toBe("today");
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
});
