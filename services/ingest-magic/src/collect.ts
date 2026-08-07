import type { NormalizedEvent } from "@town-map/contracts";
import { normalizeAll, type CollectedEvents } from "@town-map/ingestion";
import type { SearchCenter } from "./centers.js";
import { normalizeMagicEvent, type WotcEvent } from "./normalize.js";

const ENDPOINT = "https://api.tabletop.wizards.com/silverbeak-griffin-service/graphql";
const QUERY = `query queryEvents($latitude: Float!, $longitude: Float!, $maxMeters: Int!, $tags: [String!]!, $sort: EventSearchSortField, $sortDirection: EventSearchSortDirection, $orgs: [ID!], $page: Int, $pageSize: Int) {
  searchEvents(query: {latitude: $latitude, longitude: $longitude, maxMeters: $maxMeters, tags: $tags, sort: $sort, sortDirection: $sortDirection, orgs: $orgs, page: $page, pageSize: $pageSize}) {
    events {
      id capacity description emailAddress isOnline latitude longitude phoneNumber title
      scheduledStartTime status tags timeZone
      entryFee { amount currency }
      organization { id name postalAddress website }
      eventFormat { id name }
    }
    pageInfo { page pageSize totalResults }
  }
}`;

type SearchResponse = {
  data?: { searchEvents?: { events: WotcEvent[]; pageInfo: { page: number; pageSize: number; totalResults: number } } };
  errors?: Array<{ message: string }>;
};

/** Requests one circle may spend. 20 pages of 200 is 4,000 events. */
export const MAX_PAGES = 20;
const PAGE_SIZE = 200;
const LOOKAHEAD_DAYS = 180;
/** Events that began within this window are still worth showing. */
const STARTED_RECENTLY_MS = 43_200_000;

async function search(center: SearchCenter, page: number) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://locator.wizards.com",
      "user-agent": "TownMap/0.1 event indexer",
      "x-wotc-client": "client:locator version:town-map-0.1 platform:server",
    },
    body: JSON.stringify({
      operationName: "queryEvents",
      query: QUERY,
      variables: {
        latitude: center.latitude,
        longitude: center.longitude,
        maxMeters: center.radiusMeters,
        tags: ["magic:_the_gathering"],
        sort: "date",
        sortDirection: "Asc",
        orgs: [],
        page,
        pageSize: PAGE_SIZE,
      },
    }),
  });
  if (!response.ok) throw new Error(`WotC locator returned ${response.status}`);
  const body = await response.json() as SearchResponse;
  if (body.errors?.length) throw new Error(body.errors.map((error) => error.message).join("; "));
  if (!body.data?.searchEvents) throw new Error("WotC locator response did not contain searchEvents");
  return body.data.searchEvents;
}

/**
 * Reads one circle, reporting whether it reached the end of it.
 *
 * The locator is not asked for a date range, so a circle's `totalResults`
 * counts everything it holds and `MAX_PAGES` can stop short of that. The events
 * left behind are the furthest out, because the search is sorted ascending, and
 * they are indistinguishable from events withdrawn upstream unless this says so
 * -- which is how a dense metro would otherwise retire its own late calendar on
 * every run and restore it on the next as the window advanced.
 */
export async function collectMagicRegion(center: SearchCenter): Promise<CollectedEvents> {
  const unique = new Map<string, NormalizedEvent>();
  const cutoff = Date.now() + LOOKAHEAD_DAYS * 86_400_000;
  let complete = false;
  let totalResults = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await search(center, page);
    totalResults = result.pageInfo.totalResults;
    const normalizedPage = normalizeAll(
      "wotc-locator",
      result.events,
      normalizeMagicEvent,
      (event) => String(event.id),
    );
    for (const normalized of normalizedPage) {
      const startsAt = new Date(normalized.startsAt).getTime();
      if (startsAt >= Date.now() - STARTED_RECENTLY_MS && startsAt <= cutoff) {
        unique.set(normalized.sourceEventId, normalized);
      }
    }
    if ((page + 1) * result.pageInfo.pageSize >= totalResults) {
      complete = true;
      break;
    }
  }
  if (!complete) {
    console.warn(
      `${center.name} holds ${totalResults} event(s), more than ${MAX_PAGES} page(s) can read. Split the circle or narrow its radius.`,
    );
  }
  return { events: [...unique.values()], complete };
}
