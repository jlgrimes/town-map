import { NormalizedEventSchema, type EventSource, type NormalizedEvent } from "@town-map/contracts";
import {
  beginSync,
  claimNextCollectionRegion,
  closePool,
  finishCollectionRegion,
  finishSync,
  registerCollectionRegions,
  upsertEvents,
  type CollectionRegionDefinition,
} from "@town-map/db";
import { randomUUID } from "node:crypto";

export type Collector = () => Promise<NormalizedEvent[]>;

export type RegionalCollectionDefinition<TConfig extends Record<string, unknown>> =
  Omit<CollectionRegionDefinition, "config"> & { config: TConfig };

export type RegionalCollector<TConfig extends Record<string, unknown>> = (
  region: RegionalCollectionDefinition<TConfig>,
) => Promise<NormalizedEvent[]>;

function validateEvents(collected: NormalizedEvent[]) {
  return collected.map((event) => NormalizedEventSchema.parse(event));
}

function positiveIntegerEnv(name: string, fallback: number, minimum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`);
  }
  return value;
}

export function applyRolloutPolicy<TConfig extends Record<string, unknown>>(
  definitions: RegionalCollectionDefinition<TConfig>[],
): RegionalCollectionDefinition<TConfig>[] {
  const globallyEnabled = process.env.COLLECTOR_ENABLED !== "false";
  const configuredAllowlist = process.env.COLLECTOR_REGION_ALLOWLIST;
  const allowlist = configuredAllowlist === undefined
    ? null
    : new Set(configuredAllowlist.split(",").map((key) => key.trim()).filter(Boolean));
  const configuredMaxPriority = process.env.COLLECTOR_MAX_REGION_PRIORITY;
  const maxPriority = configuredMaxPriority === undefined ? null : Number(configuredMaxPriority);
  if (maxPriority !== null && !Number.isFinite(maxPriority)) {
    throw new Error("COLLECTOR_MAX_REGION_PRIORITY must be a number");
  }
  const keys = new Set<string>();

  return definitions.map((definition) => {
    if (!definition.key.trim()) throw new Error("Collection region keys cannot be empty");
    if (keys.has(definition.key)) throw new Error(`Duplicate collection region key: ${definition.key}`);
    keys.add(definition.key);
    const priority = definition.priority ?? 100;
    return {
      ...definition,
      enabled: (definition.enabled ?? true)
        && globallyEnabled
        && (allowlist === null || allowlist.has(definition.key))
        && (maxPriority === null || priority <= maxPriority),
    };
  });
}

export async function runCollector(source: EventSource, collect: Collector) {
  const dryRun = process.env.DRY_RUN === "true" || !process.env.DATABASE_URL;
  const syncId = dryRun ? null : await beginSync(source);
  let eventsSeen = 0;
  let eventsWritten = 0;
  try {
    const events = validateEvents(await collect());
    eventsSeen = events.length;
    if (dryRun) {
      console.info(JSON.stringify({ source, dryRun: true, count: events.length, sample: events.slice(0, 3) }, null, 2));
    } else {
      eventsWritten = await upsertEvents(source, events);
      await finishSync(syncId!, { status: "succeeded", eventsSeen, eventsWritten });
    }
    return { eventsSeen, eventsWritten, dryRun };
  } catch (error) {
    if (syncId) {
      await finishSync(syncId, {
        status: "failed",
        eventsSeen,
        eventsWritten,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  } finally {
    await closePool();
  }
}

export async function runRegionalCollector<TConfig extends Record<string, unknown>>(
  source: EventSource,
  definitions: RegionalCollectionDefinition<TConfig>[],
  collect: RegionalCollector<TConfig>,
) {
  if (!definitions.length) throw new Error(`${source} has no collection regions configured`);
  const effectiveDefinitions = applyRolloutPolicy(definitions);
  const dryRun = process.env.DRY_RUN === "true" || !process.env.DATABASE_URL;
  if (dryRun) {
    const enabledDefinitions = effectiveDefinitions.filter((region) => region.enabled);
    let eventsSeen = 0;
    for (const definition of enabledDefinitions) {
      const events = validateEvents(await collect(definition));
      eventsSeen += events.length;
      console.info(JSON.stringify({
        source,
        region: definition.key,
        dryRun: true,
        count: events.length,
        sample: events.slice(0, 3),
      }, null, 2));
    }
    return { regionsProcessed: enabledDefinitions.length, eventsSeen, eventsWritten: 0, dryRun: true };
  }

  const jobLimit = positiveIntegerEnv("COLLECTOR_JOB_LIMIT", 8, 1);
  const leaseMinutes = positiveIntegerEnv("COLLECTOR_LEASE_MINUTES", 30, 5);
  const retryMinutes = positiveIntegerEnv("COLLECTOR_RETRY_MINUTES", 30, 5);
  const workerId = process.env.COLLECTOR_WORKER_ID ?? `${source}:${process.pid}:${randomUUID()}`;
  const failures: Error[] = [];
  let regionsProcessed = 0;
  let eventsSeen = 0;
  let eventsWritten = 0;

  try {
    await registerCollectionRegions(source, effectiveDefinitions);
    while (regionsProcessed < jobLimit) {
      const claimed = await claimNextCollectionRegion(source, workerId, leaseMinutes);
      if (!claimed) break;
      const definition: RegionalCollectionDefinition<TConfig> = {
        key: claimed.key,
        label: claimed.label,
        countryCode: claimed.countryCode,
        cadenceMinutes: claimed.cadenceMinutes,
        config: claimed.config as TConfig,
      };
      let syncId: string | null = null;
      let regionEventsSeen = 0;
      let regionEventsWritten = 0;
      try {
        syncId = await beginSync(source, claimed);
        const events = validateEvents(await collect(definition));
        regionEventsSeen = events.length;
        regionEventsWritten = await upsertEvents(source, events);
        await finishSync(syncId, {
          status: "succeeded",
          eventsSeen: regionEventsSeen,
          eventsWritten: regionEventsWritten,
        });
        await finishCollectionRegion(claimed.id, workerId, { status: "succeeded" });
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        failures.push(new Error(`${claimed.key}: ${failure.message}`, { cause: failure }));
        if (syncId) {
          await finishSync(syncId, {
            status: "failed",
            eventsSeen: regionEventsSeen,
            eventsWritten: regionEventsWritten,
            error: failure.message,
          });
        }
        await finishCollectionRegion(claimed.id, workerId, {
          status: "failed",
          error: failure.message,
          retryMinutes,
        });
      }
      regionsProcessed += 1;
      eventsSeen += regionEventsSeen;
      eventsWritten += regionEventsWritten;
    }
  } finally {
    await closePool();
  }

  if (failures.length) throw new AggregateError(failures, `${source} failed in ${failures.length} collection region(s)`);
  return { regionsProcessed, eventsSeen, eventsWritten, dryRun: false };
}
