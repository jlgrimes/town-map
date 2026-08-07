import { runRegionalCollector, type RegionalCollectionDefinition } from "@town-map/ingestion";
import { getSearchCenters, type SearchCenter } from "./centers.js";
import { collectMagicRegion } from "./collect.js";

function regions(): RegionalCollectionDefinition<SearchCenter>[] {
  return getSearchCenters().map((center) => ({
    key: center.key ?? `circle:${center.latitude.toFixed(4)}:${center.longitude.toFixed(4)}:${center.radiusMeters}`,
    label: center.name,
    countryCode: center.countryCode ?? null,
    cadenceMinutes: center.cadenceMinutes ?? Number(process.env.COLLECTOR_REGION_CADENCE_MINUTES ?? 360),
    priority: center.priority ?? 100,
    enabled: center.enabled ?? true,
    config: center,
  }));
}

runRegionalCollector("wotc-locator", regions(), (region) => collectMagicRegion(region.config))
  .then((result) => console.info("Magic sync complete", result))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
