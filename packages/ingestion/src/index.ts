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
  const dryRun = process.env.DRY_RUN === "true" || !process.env.DATABASE_URL;
  if (dryRun) {
    const enabledDefinitions = definitions.filter((region) => region.enabled ?? true);
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

  const jobLimit = Math.max(1, Number(process.env.COLLECTOR_JOB_LIMIT ?? 8));
  const leaseMinutes = Math.max(5, Number(process.env.COLLECTOR_LEASE_MINUTES ?? 30));
  const retryMinutes = Math.max(5, Number(process.env.COLLECTOR_RETRY_MINUTES ?? 30));
  const workerId = process.env.COLLECTOR_WORKER_ID ?? `${source}:${process.pid}:${randomUUID()}`;
  const failures: Error[] = [];
  let regionsProcessed = 0;
  let eventsSeen = 0;
  let eventsWritten = 0;

  try {
    await registerCollectionRegions(source, definitions);
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
