import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Session-scoped advisory lock held for the duration of a migration run so two
 * concurrent deploys cannot apply the same file at the same time.
 */
export const MIGRATION_LOCK_ID = 8042026;

/**
 * A migration that cannot run inside a transaction — `CREATE INDEX CONCURRENTLY`
 * being the case that matters — opts out with this marker on its first line.
 */
const NO_TRANSACTION_MARKER = "-- migrate:no-transaction";

const migrationsDirectory = fileURLToPath(new URL("../migrations", import.meta.url));

export type Migration = {
  filename: string;
  sql: string;
  checksum: string;
  transactional: boolean;
};

type Queryable = {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
};

export async function readMigrations(): Promise<Migration[]> {
  const filenames = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
  return Promise.all(filenames.map(async (filename) => {
    const sql = await readFile(`${migrationsDirectory}/${filename}`, "utf8");
    return {
      filename,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
      transactional: !sql.startsWith(NO_TRANSACTION_MARKER),
    };
  }));
}

/**
 * Splits a migration into individual statements.
 *
 * PostgreSQL wraps a multi-statement simple query in an implicit transaction, so
 * a non-transactional migration has to send one statement at a time or
 * `CREATE INDEX CONCURRENTLY` is rejected. Quoted literals, identifiers,
 * dollar-quoted bodies and comments are skipped so their semicolons do not split
 * a statement.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let index = 0;
  // A fragment holding only comments and whitespace is not worth sending.
  let hasExecutableContent = false;

  const pushStatement = (end: number) => {
    const statement = sql.slice(start, end).trim();
    if (statement && hasExecutableContent) statements.push(statement);
    hasExecutableContent = false;
  };

  while (index < sql.length) {
    const character = sql[index];
    if (character === "-" && sql[index + 1] === "-") {
      const newline = sql.indexOf("\n", index);
      index = newline === -1 ? sql.length : newline + 1;
      continue;
    }
    if (character === "/" && sql[index + 1] === "*") {
      const end = sql.indexOf("*/", index + 2);
      index = end === -1 ? sql.length : end + 2;
      continue;
    }

    if (character === ";") {
      pushStatement(index);
      start = index + 1;
      index += 1;
      continue;
    }

    if (!/\s/.test(character)) hasExecutableContent = true;

    if (character === "'" || character === '"') {
      const closing = character;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === closing) {
          // A doubled quote is an escaped quote, not the end of the literal.
          if (sql[index + 1] === closing) index += 2;
          else break;
        } else index += 1;
      }
    } else if (character === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(index));
      if (tag) {
        const end = sql.indexOf(tag[0], index + tag[0].length);
        index = end === -1 ? sql.length : end + tag[0].length - 1;
      }
    }
    index += 1;
  }

  pushStatement(sql.length);
  return statements;
}

async function ensureLedger(database: Queryable) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
}

/**
 * Waits for the migration lock by polling rather than blocking inside
 * `pg_advisory_lock`.
 *
 * A blocking wait opens a transaction that stays alive until the lock is
 * granted. `CREATE INDEX CONCURRENTLY` waits for every concurrent transaction to
 * finish, so a second migrator blocking on the lock and a first migrator holding
 * it while building an index deadlock each other. Polling keeps the waiter's
 * transactions short-lived, so the index build can always complete.
 */
async function acquireLock(database: Queryable, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await database.query(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [MIGRATION_LOCK_ID],
    ) as { rows: Array<{ acquired: boolean }> };
    if (result.rows[0].acquired) return;
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for another migration run to release the migration lock");
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

/**
 * Applies every migration that is not already recorded in `schema_migrations`,
 * holding {@link MIGRATION_LOCK_ID} so concurrent deploys serialise.
 *
 * `database` must be a single session (a client, not a pool) because the lock is
 * session-scoped. A migration already recorded with a different checksum is a
 * hard error: editing an applied migration silently diverges environments.
 */
export async function applyMigrations(
  database: Queryable,
  log: (message: string) => void = () => {},
  lockTimeoutMs = 300_000,
) {
  await acquireLock(database, lockTimeoutMs);
  try {
    return await applyPendingMigrations(database, log);
  } finally {
    await database.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
  }
}

async function applyPendingMigrations(database: Queryable, log: (message: string) => void) {
  await ensureLedger(database);
  const migrations = await readMigrations();
  const applied = new Map(
    (await database.query("SELECT filename, checksum FROM schema_migrations") as { rows: Array<{ filename: string; checksum: string }> })
      .rows.map((row) => [row.filename, row.checksum]),
  );

  for (const migration of migrations) {
    const previousChecksum = applied.get(migration.filename);
    if (previousChecksum !== undefined) {
      if (previousChecksum !== migration.checksum) {
        throw new Error(
          `${migration.filename} was modified after it was applied. Migrations are immutable — add a new file instead.`,
        );
      }
      continue;
    }

    const record = async () => database.query(
      "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
      [migration.filename, migration.checksum],
    );

    if (migration.transactional) {
      await database.query("BEGIN");
      try {
        await database.query(migration.sql);
        await record();
        await database.query("COMMIT");
      } catch (error) {
        await database.query("ROLLBACK");
        throw error;
      }
    } else {
      // Runs outside a transaction, so a failure part-way leaves the migration
      // unrecorded and it is retried on the next deploy. Statements here must
      // therefore be individually re-runnable (`IF NOT EXISTS`).
      for (const statement of splitStatements(migration.sql)) await database.query(statement);
      await record();
    }
    log(`Applied ${migration.filename}`);
  }

  return migrations.filter((migration) => !applied.has(migration.filename)).map((migration) => migration.filename);
}
