import type { NormalizedEvent } from "@town-map/contracts";
import { runRegionalCollector, type RegionalCollectionDefinition } from "@town-map/ingestion";
import { normalizeRiftboundEvent, type RiftboundEvent } from "./normalize.js";

const ENDPOINT = "https://api.riftbound.uvsgames.com/api/v2/events/";

type SearchCenter = {
  key?: string;
  name: string;
  countryCode?: string;
  latitude: number;
  longitude: number;
  radiusMiles: number;
  cadenceMinutes?: number;
  priority?: number;
  enabled?: boolean;
};

type SearchResponse = {
  count?: number;
  total?: number;
  next?: number | null;
  results?: RiftboundEvent[];
};

function getCenters(): SearchCenter[] {
  const fallback = [{
    key: "us-il-chicago",
    name: "Chicago",
    countryCode: "US",
    latitude: 41.8781,
    longitude: -87.6298,
    radiusMiles: 100,
  }];
  if (!process.env.RIFTBOUND_SEARCH_CENTERS_JSON) return fallback;
  const configured = JSON.parse(process.env.RIFTBOUND_SEARCH_CENTERS_JSON) as SearchCenter[];
  if (!Array.isArray(configured) || configured.length === 0) throw new Error("RIFTBOUND_SEARCH_CENTERS_JSON must be a non-empty array");
  return configured;
}

function regions(): RegionalCollectionDefinition<SearchCenter>[] {
  return getCenters().map((center) => ({
    key: center.key ?? `circle:${center.latitude.toFixed(4)}:${center.longitude.toFixed(4)}:${center.radiusMiles}`,
    label: center.name,
    countryCode: center.countryCode ?? null,
    cadenceMinutes: center.cadenceMinutes ?? Number(process.env.COLLECTOR_REGION_CADENCE_MINUTES ?? 360),
    priority: center.priority ?? 100,
    enabled: center.enabled ?? true,
    config: center,
  }));
}

async function search(center: SearchCenter, page: number, from: Date, to: Date) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("game_slug", "riftbound");
  url.searchParams.set("start_date_after", from.toISOString());
  url.searchParams.set("start_date_before", to.toISOString());
  url.searchParams.set("display_status", "upcoming");
  url.searchParams.set("latitude", String(center.latitude));
  url.searchParams.set("longitude", String(center.longitude));
  url.searchParams.set("num_miles", String(center.radiusMiles));
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", "250");
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "TownMap/0.1 event indexer" },
  });
  if (!response.ok) throw new Error(`Riftbound locator returned ${response.status} for ${center.name}`);
  const body = await response.json() as SearchResponse;
  if (!Array.isArray(body.results)) throw new Error("Riftbound locator response did not contain results");
  return body;
}

export async function collectRiftboundRegion(center: SearchCenter): Promise<NormalizedEvent[]> {
  const from = new Date(Date.now() - 7_200_000);
  const to = new Date(Date.now() + Number(process.env.RIFTBOUND_LOOKAHEAD_DAYS ?? 180) * 86_400_000);
  const maxPages = Number(process.env.RIFTBOUND_MAX_PAGES ?? 20);
  const unique = new Map<string, NormalizedEvent>();

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await search(center, page, from, to);
    for (const event of result.results!) {
      const normalized = normalizeRiftboundEvent(event);
      unique.set(normalized.sourceEventId, normalized);
    }
    if (!result.next) return [...unique.values()];
  }
  throw new Error(`Riftbound locator exceeded RIFTBOUND_MAX_PAGES (${maxPages}) for ${center.name}`);
}

runRegionalCollector("riftbound-locator", regions(), (region) => collectRiftboundRegion(region.config))
  .then((result) => console.info("Riftbound sync complete", result))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
