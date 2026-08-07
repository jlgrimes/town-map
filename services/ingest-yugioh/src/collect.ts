import type { NormalizedEvent } from "@town-map/contracts";
import { normalizeAll, type CollectedEvents } from "@town-map/ingestion";
import { normalizeYugiohEvent, type KonamiTournament } from "./normalize.js";

const ENDPOINT = "https://cardgame-network.konami.net/mt/user/rest/tournament/US/tournament_gsearch";
/** Rows one state may ask for. The endpoint pages by index rather than refusing. */
const MAX_RESULTS = 10_000;
/** Events that began within this window are still worth showing. */
const STARTED_RECENTLY_MS = 7_200_000;
/** Video game titles the tournament feed carries alongside the card game. */
const OTHER_TITLES = /MASTER DUEL|DUEL LINKS|Legacy of the Duelist/i;

type SearchResult = { tournaments: KonamiTournament[]; complete: boolean };

async function searchState(stateCode: string): Promise<SearchResult> {
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
      indexCount: MAX_RESULTS,
      page: null,
      startSeats: null,
      endSeats: null,
      phone: null,
    }),
  });
  if (!response.ok) throw new Error(`KCGN returned ${response.status} for ${stateCode}`);
  const body = await response.json() as { result?: KonamiTournament[]; count?: number };
  const tournaments = body.result ?? [];
  // `count` is the only signal that the endpoint held back rows, and its exact
  // meaning is the source's to define. Reading it as a total only when it
  // exceeds what arrived keeps a source that reports the returned length
  // instead -- or omits it -- on the complete path it is already on.
  const complete = typeof body.count === "number" ? body.count <= tournaments.length : true;
  if (!complete) {
    console.warn(
      `${stateCode} holds ${body.count} tournament(s), more than the ${MAX_RESULTS} one request reads. Narrow its lookahead.`,
    );
  }
  return { tournaments, complete };
}

/**
 * Reads one state, reporting whether it reached the end of it.
 *
 * Withdrawal is a set comparison, so a request the endpoint truncated is
 * indistinguishable from a state whose remaining tournaments were cancelled.
 * The filtering below is not truncation: it removes rows that are not this
 * game's upcoming events, which is a smaller set on purpose and is still the
 * complete set of what the region should hold.
 */
export async function collectYugiohRegion(stateCode: string): Promise<CollectedEvents> {
  const unique = new Map<string, NormalizedEvent>();
  const { tournaments, complete } = await searchState(stateCode);
  const wanted = tournaments.filter((event) => {
    if (OTHER_TITLES.test(`${event.eventName ?? ""} ${event.tournamentName}`)) return false;
    return event.tournamentStatus !== "TOURNAMENT_FINISH"
      && event.tournamentDate >= Date.now() - STARTED_RECENTLY_MS;
  });
  for (const event of normalizeAll("konami-kcgn", wanted, normalizeYugiohEvent, (row) => row.tournamentNo)) {
    unique.set(event.sourceEventId, event);
  }
  return { events: [...unique.values()], complete };
}
