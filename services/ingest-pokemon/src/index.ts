import type { NormalizedEvent } from "@town-map/contracts";
import { runRegionalCollector, type RegionalCollectionDefinition } from "@town-map/ingestion";
import { parse } from "csv-parse/sync";
import { normalizePokemonEvent, type PokedataEvent } from "./normalize.js";

const CSV_ENDPOINT = process.env.POKEDATA_CSV_URL ?? "https://www.pokedata.ovh/events/tocsv.php";

function countries() {
  const configured = process.env.POKEMON_COUNTRIES?.split(",")
    .map((country) => country.trim().toUpperCase())
    .filter(Boolean);
  return configured?.length ? configured : [""];
}

type PokemonRegion = { country: string };

function regions(): RegionalCollectionDefinition<PokemonRegion>[] {
  return countries().map((country) => ({
    key: country || "worldwide",
    label: country || "Worldwide",
    countryCode: country || null,
    cadenceMinutes: Number(process.env.COLLECTOR_REGION_CADENCE_MINUTES ?? 360),
    config: { country },
  }));
}

function requestBody(country: string) {
  return new URLSearchParams({
    past: "",
    country,
    city: "",
    shop: "",
    league: "",
    states: "[]",
    postcode: "",
    cups: "1",
    challenges: "1",
    vcups: "",
    vchallenges: "",
    prereleases: "1",
    premier: "",
    go: "",
    gocup: "",
    mss: "",
    ftcg: "",
    fvg: "",
    fgo: "",
    latitude: "",
    longitude: "",
    radius: "",
    unit: "km",
  });
}

async function download(country: string): Promise<PokedataEvent[]> {
  const response = await fetch(CSV_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "text/csv",
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      "user-agent": "TownMap/0.1 event indexer",
    },
    body: requestBody(country),
    signal: AbortSignal.timeout(Number(process.env.POKEDATA_TIMEOUT_MS ?? 120_000)),
  });
  if (!response.ok) throw new Error(`Pokedata CSV export returned ${response.status}`);

  const csv = await response.text();
  if (!csv.startsWith("type;name;date;")) {
    throw new Error(`Pokedata CSV export returned an unexpected payload: ${csv.slice(0, 160)}`);
  }
  return parse(csv, {
    bom: true,
    columns: true,
    delimiter: ";",
    skip_empty_lines: true,
  }) as PokedataEvent[];
}

export async function collectPokemonRegion(country: string): Promise<NormalizedEvent[]> {
  const unique = new Map<string, NormalizedEvent>();
  const rows = await download(country);
  for (const row of rows) {
    const event = normalizePokemonEvent(row);
    unique.set(event.sourceEventId, event);
  }
  if (!unique.size) throw new Error("Pokedata returned no upcoming Pokémon TCG events");
  return [...unique.values()];
}

runRegionalCollector("pokedata-events", regions(), (region) => collectPokemonRegion(region.config.country))
  .then((result) => console.info("Pokémon sync complete", result))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
