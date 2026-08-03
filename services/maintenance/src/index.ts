import { closePool, deleteExpiredEvents } from "@town-map/db";

/**
 * Scheduled database maintenance.
 *
 * Runs as its own cron service rather than inside the API, which has several
 * replicas, or inside a collector, whose work is scoped to one source.
 */
function retentionDays() {
  const value = Number(process.env.EVENT_RETENTION_DAYS ?? 365);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("EVENT_RETENTION_DAYS must be a positive integer");
  }
  return value;
}

async function main() {
  const days = retentionDays();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  if (process.env.DRY_RUN === "true") {
    console.info(JSON.stringify({ dryRun: true, retentionDays: days }));
    return;
  }

  const result = await deleteExpiredEvents(days);
  console.info(JSON.stringify({
    task: "event-retention",
    retentionDays: days,
    ...result,
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
