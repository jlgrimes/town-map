import type { NormalizedEvent } from "@town-map/contracts";
import { runRegionalCollector, type RegionalCollectionDefinition } from "@town-map/ingestion";
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

type SearchCenter = {
  key?: string;
  name: string;
  countryCode?: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  cadenceMinutes?: number;
  priority?: number;
  enabled?: boolean;
};
type SearchResponse = {
  data?: { searchEvents?: { events: WotcEvent[]; pageInfo: { page: number; pageSize: number; totalResults: number } } };
  errors?: Array<{ message: string }>;
};

function getCenters(): SearchCenter[] {
  const fallback = [{ key: "us-il-chicago", name: "Chicago", countryCode: "US", latitude: 41.8781, longitude: -87.6298, radiusMeters: 100_000 }];
  if (!process.env.MAGIC_SEARCH_CENTERS_JSON) return fallback;
  return JSON.parse(process.env.MAGIC_SEARCH_CENTERS_JSON) as SearchCenter[];
}

function regions(): RegionalCollectionDefinition<SearchCenter>[] {
  return getCenters().map((center) => ({
    key: center.key ?? `circle:${center.latitude.toFixed(4)}:${center.longitude.toFixed(4)}:${center.radiusMeters}`,
    label: center.name,
    countryCode: center.countryCode ?? null,
    cadenceMinutes: center.cadenceMinutes ?? Number(process.env.COLLECTOR_REGION_CADENCE_MINUTES ?? 360),
    priority: center.priority ?? 100,
    enabled: center.enabled ?? true,
    config: center,
  }));
}

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
        pageSize: 200,
      },
    }),
  });
  if (!response.ok) throw new Error(`WotC locator returned ${response.status}`);
  const body = await response.json() as SearchResponse;
  if (body.errors?.length) throw new Error(body.errors.map((error) => error.message).join("; "));
  if (!body.data?.searchEvents) throw new Error("WotC locator response did not contain searchEvents");
  return body.data.searchEvents;
}

export async function collectMagicRegion(center: SearchCenter): Promise<NormalizedEvent[]> {
  const unique = new Map<string, NormalizedEvent>();
  const cutoff = Date.now() + 180 * 86_400_000;
  let page = 0;
  while (page < 20) {
    const result = await search(center, page);
    for (const event of result.events) {
      const normalized = normalizeMagicEvent(event);
      const startsAt = new Date(normalized.startsAt).getTime();
      if (startsAt >= Date.now() - 43_200_000 && startsAt <= cutoff) unique.set(normalized.sourceEventId, normalized);
    }
    if ((page + 1) * result.pageInfo.pageSize >= result.pageInfo.totalResults) break;
    page += 1;
  }
  return [...unique.values()];
}

runRegionalCollector("wotc-locator", regions(), (region) => collectMagicRegion(region.config))
  .then((result) => console.info("Magic sync complete", result))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
