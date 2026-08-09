import type { NormalizedEvent } from "@town-map/contracts";
import { normalizeAll, type CollectedEvents } from "@town-map/ingestion";
import type { SearchCenter } from "./centers.js";
import { normalizeRiftboundEvent, type RiftboundEvent } from "./normalize.js";

const ENDPOINT = "https://api.riftbound.uvsgames.com/api/v2/events/";
const PAGE_SIZE = 250;
/** Events that began within this window are still worth showing. */
const STARTED_RECENTLY_MS = 7_200_000;

type SearchResponse = {
  count?: number;
  total?: number;
  next?: number | string | null;
  results?: RiftboundEvent[];
};

/** Requests one circle may spend. 20 pages of 250 is 5,000 events. */
export function maxPages() {
  const value = Number(process.env.RIFTBOUND_MAX_PAGES ?? 20);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("RIFTBOUND_MAX_PAGES must be an integer greater than or equal to 1");
  }
  return value;
}

function lookaheadDays() {
  const value = Number(process.env.RIFTBOUND_LOOKAHEAD_DAYS ?? 180);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("RIFTBOUND_LOOKAHEAD_DAYS must be a number greater than zero");
  }
  return value;
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
  url.searchParams.set("page_size", String(PAGE_SIZE));
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "TownMap/0.1 event indexer" },
  });
  if (!response.ok) throw new Error(`Riftbound locator returned ${response.status} for ${center.name}`);
  const body = await response.json() as SearchResponse;
  if (!Array.isArray(body.results)) throw new Error("Riftbound locator response did not contain results");
  return body;
}

/**
 * Reads one circle, reporting whether it reached the end of it.
 *
 * A circle holding more events than the page ceiling can enumerate used to
 * throw, which failed the region and kept the events it had already read out of
 * the database entirely. Returning what it read as incomplete stores those
 * events and withholds only the withdrawal, which is the part that would be
 * wrong: withdrawal is a set comparison, so the pages never requested would
 * read as events cancelled upstream and retire a dense metro's late calendar on
 * every run. The warning names the circle to split or narrow.
 */
export async function collectRiftboundRegion(center: SearchCenter): Promise<CollectedEvents> {
  const from = new Date(Date.now() - STARTED_RECENTLY_MS);
  const to = new Date(Date.now() + lookaheadDays() * 86_400_000);
  const pageCeiling = maxPages();
  const unique = new Map<string, NormalizedEvent>();
  let held: number | undefined;

  for (let page = 1; page <= pageCeiling; page += 1) {
    const result = await search(center, page, from, to);
    held = result.count ?? result.total ?? held;
    const normalizedPage = normalizeAll(
      "riftbound-locator",
      result.results!,
      normalizeRiftboundEvent,
      (event) => String(event.id),
    );
    for (const normalized of normalizedPage) unique.set(normalized.sourceEventId, normalized);
    if (!result.next) return { events: [...unique.values()], complete: true };
  }

  console.warn(
    `${center.name} holds ${held ?? "more"} event(s), more than ${pageCeiling} page(s) of ${PAGE_SIZE} can read. Split the circle or narrow its radius.`,
  );
  return { events: [...unique.values()], complete: false };
}
