import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEvents } from "./api";

function page(ids: string[], nextCursor: string | null = null) {
  return {
    ok: true,
    json: async () => ({
      events: ids.map((id) => ({ id })),
      count: ids.length,
      nextCursor,
    }),
  } as Response;
}

describe("fetchEvents contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends every selected game on one GET /v1/events, never one request per game", async () => {
    const fetchMock = vi.fn().mockResolvedValue(page(["a"]));
    vi.stubGlobal("fetch", fetchMock);

    await fetchEvents({
      games: ["magic", "yugioh", "riftbound"],
      latitude: 37.7749,
      longitude: -122.4194,
      radiusMiles: 25,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/v1/events");
    expect(url.searchParams.get("games")).toBe("magic,yugioh,riftbound");
  });

  it("filters by lat/lng/radius, not by region or state", async () => {
    const fetchMock = vi.fn().mockResolvedValue(page(["a"]));
    vi.stubGlobal("fetch", fetchMock);

    await fetchEvents({
      games: ["magic"],
      latitude: 41.8781,
      longitude: -87.6298,
      radiusMiles: 50,
    });

    const params = new URL(fetchMock.mock.calls[0][0] as string).searchParams;
    expect(params.get("latitude")).toBe("41.8781");
    expect(params.get("longitude")).toBe("-87.6298");
    expect(params.get("radiusMiles")).toBe("50");
    expect(params.has("region")).toBe(false);
    expect(params.has("state")).toBe(false);
    expect(params.has("city")).toBe(false);
  });
});
