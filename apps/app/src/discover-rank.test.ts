import { describe, expect, it } from "vitest";
import type { EventListItem } from "@town-map/contracts";
import {
  CAROUSEL_HEADINGS,
  DEFAULT_HOME_CHIP,
  HOME_CHIPS,
  buildCarousels,
  cadenceFactor,
  dayPartFactor,
  defaultHomeChipFor,
  distanceFactor,
  gameFormatFactor,
  hasSavedPrefs,
  homeChipsFor,
  rankEvents,
  rankForChip,
  registrationHref,
  scoreEvent,
  sliceByHomeChip,
  startsSoonFactor,
  startsThisWeekend,
  startsTodayLocal,
  type RankContext,
} from "./discover-rank";

function event(overrides: Partial<EventListItem> = {}): EventListItem {
  return {
    id: "event-1",
    source: "wotc-locator",
    sourceEventId: "event-1",
    game: "magic",
    title: "Friday Night Magic",
    description: null,
    startsAt: "2026-08-21T23:00:00.000Z",
    endsAt: null,
    timezone: "America/Chicago",
    status: "scheduled",
    format: "commander",
    eventType: "Local",
    series: null,
    sourceUrl: "https://example.com/source",
    registrationUrl: "https://example.com/register",
    priceAmount: null,
    priceCurrency: "USD",
    capacity: null,
    isOnline: false,
    distanceMiles: 5,
    venue: null,
    ...overrides,
  };
}

const now = new Date("2026-08-20T18:00:00");

function ctx(overrides: Partial<RankContext> = {}): RankContext {
  return {
    now,
    selectedGames: [],
    formatFilter: "all",
    ...overrides,
  };
}

describe("Eventbrite home chips", () => {
  it("is All / For you / Today / This weekend in the catalog", () => {
    expect(HOME_CHIPS.map((chip) => chip.label)).toEqual([
      "All",
      "For you",
      "Today",
      "This weekend",
    ]);
    expect(DEFAULT_HOME_CHIP).toBe("for-you");
  });

  it("hides For you when nothing is saved — not a clone of All", () => {
    const empty = ctx();
    expect(hasSavedPrefs(empty)).toBe(false);
    expect(homeChipsFor(empty).map((chip) => chip.value)).toEqual(["all", "today", "this-weekend"]);
    expect(homeChipsFor(empty).some((chip) => chip.value === "for-you")).toBe(false);
    expect(defaultHomeChipFor(empty)).toBe("all");
  });

  it("shows For you when games or formats are saved", () => {
    expect(hasSavedPrefs(ctx({ selectedGames: ["magic"] }))).toBe(true);
    expect(homeChipsFor(ctx({ selectedGames: ["magic"] })).map((chip) => chip.value)).toContain("for-you");
    expect(defaultHomeChipFor(ctx({ selectedGames: ["magic"] }))).toBe("for-you");
    expect(homeChipsFor(ctx({ formatFilter: "commander" })).map((chip) => chip.value)).toContain("for-you");
  });
});

describe("scoreEvent factors", () => {
  it("startsSoon is 1 within ~6h and decays toward ~0.4 at 7 days", () => {
    expect(startsSoonFactor(new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString(), now)).toBe(1);
    expect(startsSoonFactor(new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(), now)).toBe(1);
    expect(
      startsSoonFactor(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(), now),
    ).toBeCloseTo(0.4, 5);
  });

  it("distance is 1 at 0mi, ~0.5 at 25mi, ~0.2 at 100mi", () => {
    expect(distanceFactor(0)).toBe(1);
    expect(distanceFactor(25)).toBeCloseTo(0.5, 5);
    expect(distanceFactor(100)).toBeCloseTo(0.2, 5);
  });

  it("gameFormat is 1 with no game/format pick, else ~0.35 on a Magic format miss", () => {
    const commander = event({ format: "commander" });
    const standard = event({ id: "std", format: "standard" });
    expect(gameFormatFactor(commander, ctx())).toBe(1);
    expect(gameFormatFactor(commander, ctx({ selectedGames: ["magic"] }))).toBe(1);
    expect(gameFormatFactor(commander, ctx({ formatFilter: "commander" }))).toBe(1);
    expect(gameFormatFactor(standard, ctx({ formatFilter: "commander" }))).toBeCloseTo(0.35, 5);
  });

  it("dayPart is 1 for local hour 16-23, else ~0.75", () => {
    const evening = new Date(now);
    evening.setHours(19, 0, 0, 0);
    const morning = new Date(now);
    morning.setHours(10, 0, 0, 0);
    expect(dayPartFactor(evening.toISOString())).toBe(1);
    expect(dayPartFactor(morning.toISOString())).toBeCloseTo(0.75, 5);
  });

  it("cadence is 1.0 weekly, 0.9 other positive cadence, 0.8 if no series", () => {
    expect(cadenceFactor(null)).toBe(0.8);
    expect(cadenceFactor({ id: "s1", cadenceDays: 7, occurrenceCount: 4, nextStartsAt: null })).toBe(1);
    expect(cadenceFactor({ id: "s2", cadenceDays: 14, occurrenceCount: 2, nextStartsAt: null })).toBe(0.9);
  });

  it("missing data is 1 so a null field never zeros the row", () => {
    expect(startsSoonFactor("not-a-date", now)).toBe(1);
    expect(distanceFactor(null)).toBe(1);
    expect(dayPartFactor("not-a-date")).toBe(1);
    expect(cadenceFactor({ id: "s3", cadenceDays: null, occurrenceCount: 1, nextStartsAt: null })).toBe(1);
    const scored = scoreEvent(event({ startsAt: "nope", distanceMiles: null, series: null }), ctx());
    expect(scored).toBeGreaterThan(0);
  });

  it("scoreEvent multiplies the five factors", () => {
    const row = event({
      startsAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      distanceMiles: 0,
      format: "commander",
      series: { id: "weekly", cadenceDays: 7, occurrenceCount: 8, nextStartsAt: null },
    });
    const evening = new Date(now);
    evening.setHours(19, 0, 0, 0);
    row.startsAt = evening.toISOString();
    expect(scoreEvent(row, ctx({ formatFilter: "commander" }))).toBeCloseTo(1, 5);
  });
});

describe("rankEvents", () => {
  it("sorts by score descending with id as the tiebreak", () => {
    const near = event({
      id: "b-near",
      distanceMiles: 1,
      startsAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    });
    const far = event({
      id: "a-far",
      distanceMiles: 80,
      startsAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    });
    expect(rankEvents([far, near], ctx()).map((row) => row.id)).toEqual(["b-near", "a-far"]);

    const twinA = event({ id: "aaa", distanceMiles: 10, startsAt: near.startsAt });
    const twinB = event({ id: "bbb", distanceMiles: 10, startsAt: near.startsAt });
    expect(rankEvents([twinB, twinA], ctx()).map((row) => row.id)).toEqual(["aaa", "bbb"]);
  });
});

describe("time chips slice the ranked list", () => {
  const thursday = new Date(2026, 7, 20, 12); // Aug 20 2026 is Thursday
  const friday = event({ id: "fri", startsAt: new Date(2026, 7, 21, 19).toISOString() });
  const saturday = event({ id: "sat", startsAt: new Date(2026, 7, 22, 13).toISOString() });
  const todayThu = event({ id: "thu", startsAt: new Date(2026, 7, 20, 18).toISOString() });
  const nextMon = event({ id: "mon", startsAt: new Date(2026, 7, 24, 19).toISOString() });
  const ranked = [friday, saturday, todayThu, nextMon];

  it("All and For you keep the full ranked list", () => {
    expect(sliceByHomeChip(ranked, "all", thursday).map((row) => row.id)).toEqual([
      "fri",
      "sat",
      "thu",
      "mon",
    ]);
    expect(sliceByHomeChip(ranked, "for-you", thursday).map((row) => row.id)).toEqual([
      "fri",
      "sat",
      "thu",
      "mon",
    ]);
  });

  it("Today keeps starts that land on the local calendar day", () => {
    expect(startsTodayLocal(todayThu.startsAt, thursday)).toBe(true);
    expect(sliceByHomeChip(ranked, "today", thursday).map((row) => row.id)).toEqual(["thu"]);
  });

  it("This weekend is upcoming Fri-Sun from Thursday, and this Fri-Sun on Saturday", () => {
    expect(startsThisWeekend(friday.startsAt, thursday)).toBe(true);
    expect(startsThisWeekend(nextMon.startsAt, thursday)).toBe(false);
    expect(sliceByHomeChip(ranked, "this-weekend", thursday).map((row) => row.id)).toEqual([
      "fri",
      "sat",
    ]);
    const saturdayNow = new Date(2026, 7, 22, 9);
    expect(sliceByHomeChip(ranked, "this-weekend", saturdayNow).map((row) => row.id)).toEqual([
      "fri",
      "sat",
    ]);
  });
});

describe("All is not For you", () => {
  const soon = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const savedMagic = event({ id: "magic-saved", game: "magic", distanceMiles: 10, startsAt: soon });
  const otherYgo = event({ id: "ygo-near", game: "yugioh", distanceMiles: 1, startsAt: soon });

  it("fails if For you is All with a different label when games are saved", () => {
    const withGames = ctx({ selectedGames: ["magic"] });
    const allIds = rankForChip([savedMagic, otherYgo], "all", withGames).map((row) => row.id);
    const forYouIds = rankForChip([savedMagic, otherYgo], "for-you", withGames).map((row) => row.id);
    expect(allIds).toEqual(["ygo-near", "magic-saved"]);
    expect(forYouIds).not.toEqual(allIds);
    expect(forYouIds[0]).toBe("magic-saved");
  });

  it("fails if For you is All with a different label when a format is saved", () => {
    const commander = event({
      id: "commander",
      game: "magic",
      format: "commander",
      distanceMiles: 10,
      startsAt: soon,
    });
    const standard = event({
      id: "standard",
      game: "magic",
      format: "standard",
      distanceMiles: 1,
      startsAt: soon,
    });
    const withFormat = ctx({ selectedGames: ["magic"], formatFilter: "commander" });
    const allIds = rankForChip([commander, standard], "all", withFormat).map((row) => row.id);
    const forYouIds = rankForChip([commander, standard], "for-you", withFormat).map((row) => row.id);
    expect(allIds).toEqual(["standard", "commander"]);
    expect(forYouIds).not.toEqual(allIds);
    expect(forYouIds[0]).toBe("commander");
  });

  it("fails if empty prefs still serve For you as a clone of All", () => {
    const empty = ctx();
    expect(homeChipsFor(empty).map((chip) => chip.value)).not.toContain("for-you");
    expect(
      buildCarousels(rankForChip([savedMagic, otherYgo], "all", empty), { forYou: false }).map((row) => row.heading),
    ).not.toContain("For you");
  });

  it("documents the one ranked list All === For you shape the lock forbids", () => {
    const withGames = ctx({ selectedGames: ["magic"] });
    const rankedOnce = rankEvents([savedMagic, otherYgo], withGames);
    expect(sliceByHomeChip(rankedOnce, "for-you", now)).toEqual(sliceByHomeChip(rankedOnce, "all", now));
  });
});

describe("carousels", () => {
  it("uses For you / Starting soon / Nearby / Repeats weekly and never the reversed-brief labels", () => {
    expect([...CAROUSEL_HEADINGS]).toEqual([
      "For you",
      "Starting soon",
      "Nearby",
      "Repeats weekly",
    ]);
    expect(CAROUSEL_HEADINGS).not.toContain("Tonight near you");
    expect(CAROUSEL_HEADINGS).not.toContain("Walkable");
    expect(CAROUSEL_HEADINGS).not.toContain("Your formats");
  });

  it("builds those four rows from the sliced ranked list and hides empty ones", () => {
    const weekly = event({
      id: "weekly",
      distanceMiles: 40,
      startsAt: new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(),
      series: { id: "s", cadenceDays: 7, occurrenceCount: 6, nextStartsAt: null },
    });
    const soonClose = event({
      id: "soon-close",
      distanceMiles: 2,
      startsAt: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    });
    const laterFar = event({
      id: "later-far",
      distanceMiles: 90,
      startsAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const rows = buildCarousels(rankEvents([laterFar, weekly, soonClose], ctx()));
    expect(rows.map((row) => row.heading)).toEqual([
      "For you",
      "Starting soon",
      "Nearby",
      "Repeats weekly",
    ]);
    expect(rows.find((row) => row.heading === "Starting soon")?.events[0]?.id).toBe("soon-close");
    expect(rows.find((row) => row.heading === "Nearby")?.events[0]?.id).toBe("soon-close");
    expect(rows.find((row) => row.heading === "Repeats weekly")?.events.map((row) => row.id)).toEqual([
      "weekly",
    ]);
    expect(buildCarousels([]).map((row) => row.heading)).toEqual([]);
  });

  it("allows the same event in more than one carousel", () => {
    const only = event({
      id: "only",
      distanceMiles: 1,
      startsAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      series: { id: "s", cadenceDays: 7, occurrenceCount: 3, nextStartsAt: null },
    });
    const headings = buildCarousels([only]).map((row) => row.heading);
    expect(headings).toEqual(["For you", "Starting soon", "Nearby", "Repeats weekly"]);
  });

  it("hides the For you row when it would be a clone of All", () => {
    const only = event({
      id: "only",
      distanceMiles: 1,
      startsAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    });
    expect(buildCarousels([only], { forYou: false }).map((row) => row.heading)).not.toContain("For you");
  });
});

describe("one tap register", () => {
  it("opens registrationUrl falling back to sourceUrl", () => {
    expect(registrationHref(event())).toBe("https://example.com/register");
    expect(registrationHref(event({ registrationUrl: null }))).toBe("https://example.com/source");
    expect(registrationHref(event({ registrationUrl: null, sourceUrl: null }))).toBeNull();
  });
});
