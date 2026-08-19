import { NormalizedEventSchema, type EventSource, type NormalizedEvent } from "@town-map/contracts";
import {
  assignEventSeries,
  beginSync,
  claimNextCollectionRegion,
  closePool,
  finishCollectionRegion,
  finishSync,
  refreshSourceEventCount,
  registerCollectionRegions,
  upsertEvents,
  withdrawMissingEvents,
  type CollectionRegionDefinition,
} from "@town-map/db";
import { randomUUID } from "node:crypto";

export type Collector = () => Promise<NormalizedEvent[]>;

export type RegionalCollectionDefinition<TConfig extends Record<string, unknown>> =
  Omit<CollectionRegionDefinition, "config"> & { config: TConfig };

/**
 * A region's events, and whether they are all of them.
 *
 * `complete` is what entitles a run to withdraw: withdrawal is a set
 * comparison, so it reads anything a collector did not return as gone from
 * upstream. A collector that stopped early -- a page ceiling, a budget, a
 * partial upstream response -- returns events that look identical to a
 * complete set and are not one, and withdrawing against it retires events that
 * are still scheduled. Returning a bare array means complete, which is true of
 * a collector that enumerates its region in one pass.
 */
export type CollectedEvents = { events: NormalizedEvent[]; complete: boolean };

export type RegionalCollector<TConfig extends Record<string, unknown>> = (
  region: RegionalCollectionDefinition<TConfig>,
) => Promise<NormalizedEvent[] | CollectedEvents>;

function asCollected(result: NormalizedEvent[] | CollectedEvents): CollectedEvents {
  return Array.isArray(result) ? { events: result, complete: true } : result;
}

/**
 * How much of a batch may be discarded before the run is treated as a broken
 * source rather than as bad rows.
 *
 * Individual malformed records are normal and cost only themselves. A source
 * that changes shape invalidates everything at once, and silently collecting
 * nothing is the failure mode worth shouting about, so past this share the
 * region fails and keeps whatever it already had.
 */
function maxSkippedShare() {
  const configured = process.env.COLLECTOR_MAX_SKIPPED_SHARE;
  if (configured === undefined) return 0.5;
  const value = Number(configured);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("COLLECTOR_MAX_SKIPPED_SHARE must be a number between 0 and 1");
  }
  return value;
}

/** Number of discarded records described in full before the rest are counted only. */
const REPORTED_SKIP_LIMIT = 5;

function reportSkipped(source: EventSource, stage: string, skipped: string[], total: number) {
  if (!skipped.length) return;
  const share = skipped.length / total;
  const summary = `${source}: ${stage} discarded ${skipped.length} of ${total} record(s)`;
  const detail = skipped.slice(0, REPORTED_SKIP_LIMIT).join("; ");
  if (share > maxSkippedShare()) {
    throw new Error(`${summary}, which is more than one source can lose to bad records: ${detail}`);
  }
  console.warn(`${summary}: ${detail}`);
}

/**
 * Normalizes upstream records, dropping the ones that cannot be normalized.
 *
 * A normalizer reads whatever a source published, so a single record with a
 * missing date or an unparseable field can throw. Without this that exception
 * escaped the collector and discarded every record gathered alongside it.
 */
export function normalizeAll<TRow>(
  source: EventSource,
  rows: readonly TRow[],
  normalize: (row: TRow) => NormalizedEvent,
  identify: (row: TRow) => string,
): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    try {
      events.push(normalize(row));
    } catch (error) {
      skipped.push(`${identify(row)} (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  reportSkipped(source, "normalizing", skipped, rows.length);
  return events;
}

/**
 * Validates collected events, dropping the ones that do not describe an event.
 *
 * Descriptive fields a source got wrong are already coerced to null by the
 * schema, so what reaches here is an event missing its identity -- no title, no
 * start -- and storing it would be worse than losing it.
 */
function validateEvents(source: EventSource, collected: NormalizedEvent[]) {
  const events: NormalizedEvent[] = [];
  const skipped: string[] = [];
  for (const event of collected) {
    const result = NormalizedEventSchema.safeParse(event);
    if (result.success) {
      events.push(result.data);
      continue;
    }
    const paths = result.error.issues.map((issue) => issue.path.join(".") || "(root)").join(", ");
    skipped.push(`${event?.sourceEventId ?? "(no id)"} (invalid: ${paths})`);
  }
  reportSkipped(source, "validation", skipped, collected.length);
  return events;
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
    const events = validateEvents(source, await collect());
    eventsSeen = events.length;
    if (dryRun) {
      console.info(JSON.stringify({ source, dryRun: true, count: events.length, sample: events.slice(0, 3) }, null, 2));
    } else {
      eventsWritten = (await upsertEvents(source, events)).written;
      await finishSync(syncId!, { status: "succeeded", eventsSeen, eventsWritten });
      await refreshSourceEventCount(source);
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
      const collected = asCollected(await collect(definition));
      const events = validateEvents(source, collected.events);
      eventsSeen += events.length;
      console.info(JSON.stringify({
        source,
        region: definition.key,
        dryRun: true,
        complete: collected.complete,
        count: events.length,
        sample: events.slice(0, 3),
      }, null, 2));
    }
    return { regionsProcessed: enabledDefinitions.length, eventsSeen, eventsWritten: 0, dryRun: true };
  }

  const jobLimit = positiveIntegerEnv("COLLECTOR_JOB_LIMIT", 32, 1);
  const leaseMinutes = positiveIntegerEnv("COLLECTOR_LEASE_MINUTES", 30, 5);
  const retryMinutes = positiveIntegerEnv("COLLECTOR_RETRY_MINUTES", 30, 5);
  const workerId = process.env.COLLECTOR_WORKER_ID ?? `${source}:${process.pid}:${randomUUID()}`;
  const failures: Error[] = [];
  let regionsProcessed = 0;
  let eventsSeen = 0;
  let eventsWritten = 0;
  let eventsSkipped = 0;
  let eventsWithdrawn = 0;

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
      let regionEventsSkipped = 0;
      let regionEventsWithdrawn = 0;
      try {
        syncId = await beginSync(source, claimed);
        const collected = asCollected(await collect(definition));
        const events = validateEvents(source, collected.events);
        regionEventsSeen = events.length;
        const written = await upsertEvents(source, events, { collectionRegionId: claimed.id });
        regionEventsWritten = written.written;
        regionEventsSkipped = written.skipped;
        if (collected.complete) {
          regionEventsWithdrawn = await withdrawMissingEvents(
            claimed.id,
            events.map((event) => event.sourceEventId),
          );
        } else {
          console.warn(
            `${source}: ${claimed.key} returned a partial result, so its ${events.length} event(s) were stored without withdrawing anything`,
          );
        }
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
      eventsSkipped += regionEventsSkipped;
      eventsWithdrawn += regionEventsWithdrawn;
    }

    if (regionsProcessed > failures.length) {
      try {
        await refreshSourceEventCount(source);
      } catch (error) {
        failures.push(new Error(`refreshing ${source} event count`, { cause: error }));
      }
      try {
        await assignEventSeries(source);
      } catch (error) {
        failures.push(new Error(`assigning ${source} event series`, { cause: error }));
      }
    }
  } finally {
    await closePool();
  }

  if (failures.length) throw new AggregateError(failures, `${source} failed in ${failures.length} collection region(s)`);
  return { regionsProcessed, eventsSeen, eventsWritten, eventsSkipped, eventsWithdrawn, dryRun: false };
}
