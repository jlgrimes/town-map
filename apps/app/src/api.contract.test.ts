import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEvents, geocodePlace } from "./api";

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

describe("typed place to events", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves a city or ZIP through GET /v1/geocode, never IP geo", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ latitude: 41.8781, longitude: -87.6298, label: "Chicago, IL" }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(geocodePlace("60601")).resolves.toEqual({
      latitude: 41.8781,
      longitude: -87.6298,
      label: "Chicago, IL",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/v1/geocode");
    expect(url.searchParams.get("q")).toBe("60601");
    expect(url.pathname).not.toMatch(/ip|geoip/i);
  });

  it("loads events from the geocoded place in one GET /v1/events", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ latitude: 41.8781, longitude: -87.6298, label: "Chicago, IL" }),
      } as Response)
      .mockResolvedValueOnce(page(["tonight"]));
    vi.stubGlobal("fetch", fetchMock);

    const place = await geocodePlace("Chicago, IL");
    if (!place) throw new Error("expected a geocoded place");
    await fetchEvents({
      games: ["magic", "yugioh", "riftbound", "pokemon", "onepiece"],
      latitude: place.latitude,
      longitude: place.longitude,
      radiusMiles: 25,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const geocodeUrl = new URL(fetchMock.mock.calls[0][0] as string);
    const eventsUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(geocodeUrl.pathname).toBe("/v1/geocode");
    expect(eventsUrl.pathname).toBe("/v1/events");
    expect(eventsUrl.searchParams.get("latitude")).toBe("41.8781");
    expect(eventsUrl.searchParams.get("longitude")).toBe("-87.6298");
    expect(eventsUrl.searchParams.has("region")).toBe(false);
  });
});
