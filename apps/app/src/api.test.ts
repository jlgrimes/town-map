import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEvents, normalizeUserPreferences, saveUserPreferences } from "./api";

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

  it("sends the text query on every page, so the filter is the API's to apply", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(page(["a"], "cursor-1"))
      .mockResolvedValueOnce(page(["b"], null));
    vi.stubGlobal("fetch", fetchMock);

    await fetchEvents({ games: ["magic"], query: "  friday night  " });

    for (const [url] of fetchMock.mock.calls) {
      expect(new URL(url as string).searchParams.get("q")).toBe("friday night");
    }
  });

  it("omits an empty query rather than filtering on whitespace", async () => {
    const fetchMock = vi.fn().mockResolvedValue(page(["only"], null));
    vi.stubGlobal("fetch", fetchMock);

    await fetchEvents({ games: ["magic"], query: "   " });

    const [url] = fetchMock.mock.calls[0];
    expect(new URL(url as string).searchParams.has("q")).toBe(false);
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

  it("fills a legacy response from the caller's fallback when given one", () => {
    expect(normalizeUserPreferences({ homeAddress: "Chicago, IL" }, {
      selectedGames: ["magic"],
      onboardingCompleted: true,
    })).toEqual({
      homeAddress: "Chicago, IL",
      selectedGames: ["magic"],
      onboardingCompleted: true,
    });
  });
});

describe("saveUserPreferences", () => {
  afterEach(() => vi.unstubAllGlobals());
  const token = async () => "test-token";

  it("accepts a legacy response that omits onboarding fields", async () => {
    // The deployed API predates onboarding and returns only homeAddress.
    // Parsing this strictly failed a save the API had already accepted.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ homeAddress: "Chicago, IL" }),
    } as Response));

    await expect(saveUserPreferences(
      { homeAddress: "Chicago, IL", selectedGames: ["magic", "pokemon"] },
      token,
    )).resolves.toEqual({
      homeAddress: "Chicago, IL",
      selectedGames: ["magic", "pokemon"],
      onboardingCompleted: true,
    });
  });

  it("prefers the API's own values when it returns the current shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        homeAddress: "Evanston, IL",
        selectedGames: ["yugioh"],
        onboardingCompleted: true,
      }),
    } as Response));

    await expect(saveUserPreferences(
      { homeAddress: "Chicago, IL", selectedGames: ["magic"] },
      token,
    )).resolves.toEqual({
      homeAddress: "Evanston, IL",
      selectedGames: ["yugioh"],
      onboardingCompleted: true,
    });
  });

  it("surfaces the API's error message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "Unknown game: chess" }),
    } as Response));

    await expect(saveUserPreferences(
      { homeAddress: "Chicago, IL", selectedGames: ["chess"] },
      token,
    )).rejects.toThrow("Unknown game: chess");
  });
});
