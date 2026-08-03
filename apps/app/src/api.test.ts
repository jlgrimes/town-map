import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEvents, normalizeUserPreferences } from "./api";

function page(ids: string[], nextCursor: string | null) {
  return {
    ok: true,
    json: async () => ({
      events: ids.map((id) => ({ id })),
      count: ids.length,
      nextCursor,
    }),
  } as Response;
}

function requestedCursors(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls.map(([url]) => new URL(url as string).searchParams.get("cursor"));
}

describe("fetchEvents", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("follows the cursor until the results are exhausted", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(page(["a", "b"], "cursor-1"))
      .mockResolvedValueOnce(page(["c"], null));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchEvents({ games: ["magic"] })).resolves.toEqual({
      events: [{ id: "a" }, { id: "b" }, { id: "c" }],
      truncated: false,
    });
    expect(requestedCursors(fetchMock)).toEqual([null, "cursor-1"]);
  });

  it("makes a single request when the first page is the last", async () => {
    const fetchMock = vi.fn().mockResolvedValue(page(["only"], null));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchEvents({ games: [] })).resolves.toEqual({
      events: [{ id: "only" }],
      truncated: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops at the page ceiling and reports the results as truncated", async () => {
    // A cursor is always returned, so only the ceiling can end the loop.
    const fetchMock = vi.fn().mockResolvedValue(page(["x"], "always-more"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchEvents({ games: ["magic"] });

    expect(result.truncated).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(result.events).toHaveLength(5);
  });

  it("sends the location filter on every page, not just the first", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(page(["a"], "cursor-1"))
      .mockResolvedValueOnce(page(["b"], null));
    vi.stubGlobal("fetch", fetchMock);

    await fetchEvents({ games: ["magic"], latitude: 41.8781, longitude: -87.6298, radiusMiles: 30 });

    for (const [url] of fetchMock.mock.calls) {
      const params = new URL(url as string).searchParams;
      expect(params.get("latitude")).toBe("41.8781");
      expect(params.get("radiusMiles")).toBe("30");
    }
  });

  it("surfaces a failed page instead of returning a partial result", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(page(["a"], "cursor-1"))
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchEvents({ games: ["magic"] })).rejects.toThrow("503");
  });
});

describe("normalizeUserPreferences", () => {
  it("accepts current onboarding preferences", () => {
    expect(normalizeUserPreferences({
      homeAddress: "Chicago, IL",
      selectedGames: ["magic", "pokemon"],
      onboardingCompleted: true,
    })).toEqual({
      homeAddress: "Chicago, IL",
      selectedGames: ["magic", "pokemon"],
      onboardingCompleted: true,
    });
  });

  it("treats a legacy home-only response as incomplete onboarding", () => {
    expect(normalizeUserPreferences({ homeAddress: "Chicago, IL" })).toEqual({
      homeAddress: "Chicago, IL",
      selectedGames: [],
      onboardingCompleted: false,
    });
  });

  it("rejects malformed preference responses", () => {
    expect(() => normalizeUserPreferences({ selectedGames: [] })).toThrow("invalid data");
  });
});
