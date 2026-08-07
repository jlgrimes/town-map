import { afterEach, describe, expect, it, vi } from "vitest";
import { collectYugiohRegion } from "./collect.js";

function tournament(overrides: Record<string, unknown> = {}) {
  return {
    tournamentNo: "t-1",
    tournamentName: "Locals",
    tournamentDate: Date.now() + 3 * 86_400_000,
    tournamentStatus: "TOURNAMENT_OPEN",
    storeCode: "store-1",
    storeName: "The Game Store",
    location: { locationName: "The Game Store", stateCode: "CA" },
    ...overrides,
  };
}

function stubKcgn(payload: { result?: unknown[]; count?: number }) {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => payload }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("collectYugiohRegion", () => {
  it("reports a state it read to the end as complete", async () => {
    stubKcgn({ result: [tournament()], count: 1 });

    const result = await collectYugiohRegion("CA");

    expect(result.complete).toBe(true);
    expect(result.events).toHaveLength(1);
  });

  it("treats a response with no count as complete", async () => {
    stubKcgn({ result: [tournament()] });

    expect((await collectYugiohRegion("CA")).complete).toBe(true);
  });

  // Withdrawal is a set comparison, so a truncated read that claimed to be
  // complete would retire every tournament the endpoint held back.
  it("reports a state the endpoint truncated as incomplete", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubKcgn({ result: [tournament()], count: 12_000 });

    const result = await collectYugiohRegion("CA");

    expect(result.complete).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("CA holds 12000 tournament(s)"));
    warn.mockRestore();
  });

  // Filtering is not truncation: what is left is still all the region should
  // hold, so it must not suppress withdrawal.
  it("stays complete while dropping finished and video-game tournaments", async () => {
    stubKcgn({
      count: 4,
      result: [
        tournament(),
        tournament({ tournamentNo: "t-2", tournamentStatus: "TOURNAMENT_FINISH" }),
        tournament({ tournamentNo: "t-3", tournamentName: "MASTER DUEL Cup" }),
        tournament({ tournamentNo: "t-4", tournamentDate: Date.now() - 30 * 86_400_000 }),
      ],
    });

    const result = await collectYugiohRegion("CA");

    expect(result.events.map((event) => event.sourceEventId)).toEqual(["t-1"]);
    expect(result.complete).toBe(true);
  });

  it("asks the endpoint for the state it was given", async () => {
    const fetchMock = stubKcgn({ result: [], count: 0 });

    await collectYugiohRegion("CA");

    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.stateCodes).toEqual(["CA"]);
    expect(body.nationCodes).toEqual(["US"]);
  });
});
