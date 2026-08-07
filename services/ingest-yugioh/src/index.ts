import { runRegionalCollector, type RegionalCollectionDefinition } from "@town-map/ingestion";
import { collectYugiohRegion } from "./collect.js";
import { getStates } from "./states.js";

type YugiohRegion = { stateCode: string };

function regions(): RegionalCollectionDefinition<YugiohRegion>[] {
  return getStates().map((state) => ({
    key: `US:${state.code}`,
    label: `United States — ${state.code}`,
    countryCode: "US",
    cadenceMinutes: Number(process.env.COLLECTOR_REGION_CADENCE_MINUTES ?? 360),
    priority: state.priority ?? 100,
    enabled: state.enabled ?? true,
    config: { stateCode: state.code },
  }));
}

runRegionalCollector("konami-kcgn", regions(), (region) => collectYugiohRegion(region.config.stateCode))
  .then((result) => console.info("Yu-Gi-Oh! sync complete", result))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
