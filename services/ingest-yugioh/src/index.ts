import type { NormalizedEvent } from "@town-map/contracts";
import { runCollector } from "@town-map/ingestion";
import { normalizeYugiohEvent, type KonamiTournament } from "./normalize.js";

const ENDPOINT = "https://cardgame-network.konami.net/mt/user/rest/tournament/US/tournament_gsearch";

function states() {
  return (process.env.YUGIOH_STATES ?? "IL").split(",").map((state) => state.trim().toUpperCase()).filter(Boolean);
}

async function searchState(stateCode: string): Promise<KonamiTournament[]> {
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + Number(process.env.YUGIOH_LOOKAHEAD_DAYS ?? 90));
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json;charset=UTF-8",
      origin: "https://cardgame-network.konami.net",
      referer: "https://cardgame-network.konami.net/",
      "user-agent": "TownMap/0.1 event indexer",
    },
    body: JSON.stringify({
      tournamentNo: null,
      startDate: startDate.getTime(),
      endDate: endDate.getTime(),
      eventType: null,
      storeName: null,
      keyword: "",
      startTime: null,
      endTime: null,
      reserveable: false,
      structure: null,
      gpsSearch: false,
      gpsRange: "10000",
      latitude: null,
      longitude: null,
      ageLimits: null,
      webOpenDate: startDate.getTime(),
      nationCodes: ["US"],
      stateCodes: [stateCode],
      eventGrpId: null,
      sortType: null,
      tabType: null,
      indexStart: 0,
      indexCount: 10_000,
      page: null,
      startSeats: null,
      endSeats: null,
      phone: null,
    }),
  });
  if (!response.ok) throw new Error(`KCGN returned ${response.status} for ${stateCode}`);
  const body = await response.json() as { result?: KonamiTournament[]; count?: number };
  return body.result ?? [];
}

export async function collectYugiohEvents(): Promise<NormalizedEvent[]> {
  const unique = new Map<string, NormalizedEvent>();
  for (const state of states()) {
    const results = await searchState(state);
    for (const event of results) {
      if (/MASTER DUEL|DUEL LINKS|Legacy of the Duelist/i.test(`${event.eventName ?? ""} ${event.tournamentName}`)) continue;
      if (event.tournamentStatus === "TOURNAMENT_FINISH" || event.tournamentDate < Date.now() - 7_200_000) continue;
      unique.set(event.tournamentNo, normalizeYugiohEvent(event));
    }
  }
  return [...unique.values()];
}

runCollector("konami-kcgn", collectYugiohEvents)
  .then((result) => console.info("Yu-Gi-Oh! sync complete", result))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
