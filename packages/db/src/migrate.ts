import { closePool, getPool } from "./index.js";
import { applyMigrations } from "./migrations.js";

async function migrate() {
  // A dedicated client keeps the session-scoped migration lock on one session.
  const client = await getPool().connect();
  try {
    // Index builds and backfills legitimately run for minutes, so a statement
    // ceiling configured for request traffic must not apply here.
    await client.query("SET statement_timeout = 0");
    const applied = await applyMigrations(client, (message) => console.info(message));
    console.info(applied.length ? `Applied ${applied.length} migration(s)` : "Database is up to date");
  } finally {
    client.release();
    await closePool();
  }
}

migrate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
