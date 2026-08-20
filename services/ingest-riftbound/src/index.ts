import { runRegionalCollector, type RegionalCollectionDefinition } from "@town-map/ingestion";
import { DEFAULT_SEARCH_CENTERS, type SearchCenter } from "./centers.js";
import { collectRiftboundRegion } from "./collect.js";

function regions(): RegionalCollectionDefinition<SearchCenter>[] {
  return DEFAULT_SEARCH_CENTERS.map((center) => ({
    key: center.key ?? `circle:${center.latitude.toFixed(4)}:${center.longitude.toFixed(4)}:${center.radiusMiles}`,
    label: center.name,
    countryCode: center.countryCode ?? null,
    cadenceMinutes: center.cadenceMinutes ?? Number(process.env.COLLECTOR_REGION_CADENCE_MINUTES ?? 360),
    priority: center.priority ?? 100,
    enabled: center.enabled ?? true,
    config: center,
  }));
}

runRegionalCollector("riftbound-locator", regions(), (region) => collectRiftboundRegion(region.config))
  .then((result) => console.info("Riftbound sync complete", result))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
