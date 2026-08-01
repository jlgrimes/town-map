import { NormalizedEventSchema, type EventSource, type NormalizedEvent } from "@town-map/contracts";
import { beginSync, closePool, finishSync, upsertEvent } from "@town-map/db";

export type Collector = () => Promise<NormalizedEvent[]>;

export async function runCollector(source: EventSource, collect: Collector) {
  const dryRun = process.env.DRY_RUN === "true" || !process.env.DATABASE_URL;
  const syncId = dryRun ? null : await beginSync(source);
  let eventsSeen = 0;
  let eventsWritten = 0;
  try {
    const collected = await collect();
    const events = collected.map((event) => NormalizedEventSchema.parse(event));
    eventsSeen = events.length;
    if (dryRun) {
      console.info(JSON.stringify({ source, dryRun: true, count: events.length, sample: events.slice(0, 3) }, null, 2));
    } else {
      for (const event of events) {
        await upsertEvent(source, event);
        eventsWritten += 1;
      }
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
