import type { NormalizedEvent } from "@town-map/contracts";
import { normalizeAll, runRegionalCollector, type RegionalCollectionDefinition } from "@town-map/ingestion";
import { normalizeOnePieceEvent, type BandaiEvent } from "./normalize.js";
import { getRegions, type OnePieceRegion } from "./regions.js";

const ENDPOINT = "https://api.bandai-tcg-plus.com/api/user/event/list";
const DEFAULT_USER_AGENT = "Mozilla/5.0 (compatible; TownMap/0.1; +https://town-map-eight.vercel.app)";

type SearchResponse = {
  success?: { event_list?: BandaiEvent[]; total?: number };
  error?: { message?: string } | string;
};

function regions(): RegionalCollectionDefinition<OnePieceRegion>[] {
  return getRegions().map((region) => ({
    key: region.key ?? `${region.countryCode}:${region.prefCodes?.join("+") || "all"}`,
    label: region.name,
    countryCode: region.countryCode,
    cadenceMinutes: region.cadenceMinutes ?? Number(process.env.COLLECTOR_REGION_CADENCE_MINUTES ?? 360),
    priority: region.priority ?? 100,
    enabled: region.enabled ?? true,
    config: region,
  }));
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function search(region: OnePieceRegion, offset: number, limit: number, startDate: Date, endDate: Date) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("game_title_id", "4");
  url.searchParams.set("start_date", dateOnly(startDate));
  url.searchParams.set("end_date", dateOnly(endDate));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  url.searchParams.append("country_code[]", region.countryCode);
  for (const prefCode of region.prefCodes ?? []) url.searchParams.append("pref_code[]", prefCode);

  const response = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      origin: "https://www.bandai-tcg-plus.com",
      referer: "https://www.bandai-tcg-plus.com/",
      "user-agent": process.env.BANDAI_USER_AGENT ?? DEFAULT_USER_AGENT,
    },
  });
  if (!response.ok) throw new Error(`Bandai TCG+ returned ${response.status} for ${region.name}`);
  const body = await response.json() as SearchResponse;
  if (!body.success) {
    const detail = typeof body.error === "string" ? body.error : body.error?.message;
    throw new Error(`Bandai TCG+ response did not contain success${detail ? `: ${detail}` : ""}`);
  }
  return { events: body.success.event_list ?? [], total: body.success.total ?? 0 };
}

export async function collectOnePieceRegion(region: OnePieceRegion): Promise<NormalizedEvent[]> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const startDate = new Date(today);
  startDate.setUTCDate(startDate.getUTCDate() - 1);
  const endDate = new Date(today);
  endDate.setUTCDate(endDate.getUTCDate() + Number(process.env.ONEPIECE_LOOKAHEAD_DAYS ?? 90) + 1);
  const pageSize = 100;
  const maxPages = Number(process.env.ONEPIECE_MAX_PAGES ?? 100);
  const unique = new Map<string, NormalizedEvent>();

  for (let page = 0; page < maxPages; page += 1) {
    const result = await search(region, page * pageSize, pageSize, startDate, endDate);
    const normalizedPage = normalizeAll(
      "bandai-tcg-plus",
      result.events,
      normalizeOnePieceEvent,
      (event) => String(event.id),
    );
    for (const normalized of normalizedPage) {
      if (new Date(normalized.startsAt).getTime() >= Date.now() - 7_200_000) unique.set(normalized.sourceEventId, normalized);
    }
    if ((page + 1) * pageSize >= result.total) return [...unique.values()];
  }
  throw new Error(`Bandai TCG+ exceeded ONEPIECE_MAX_PAGES (${maxPages}) for ${region.name}`);
}

runRegionalCollector("bandai-tcg-plus", regions(), (region) => collectOnePieceRegion(region.config))
  .then((result) => console.info("One Piece sync complete", result))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
