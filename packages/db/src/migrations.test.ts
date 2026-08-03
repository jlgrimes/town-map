import { describe, expect, it } from "vitest";
import { readMigrations, splitStatements } from "./migrations.js";

describe("splitStatements", () => {
  it("splits on statement boundaries, ignoring semicolons inside comments", () => {
    // A comment preceding a statement stays attached to it, which PostgreSQL
    // accepts; only the boundaries matter.
    const statements = splitStatements(`
      -- a leading comment; with a semicolon
      CREATE INDEX CONCURRENTLY IF NOT EXISTS a_idx ON a (b);
      CREATE INDEX CONCURRENTLY IF NOT EXISTS c_idx ON c (d);
    `);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("CREATE INDEX CONCURRENTLY IF NOT EXISTS a_idx ON a (b)");
    expect(statements[0]).not.toContain("c_idx");
    expect(statements[1]).toBe("CREATE INDEX CONCURRENTLY IF NOT EXISTS c_idx ON c (d)");
  });

  it("produces no statement for a comments-only input", () => {
    expect(splitStatements("-- nothing here;\n/* or here; */\n")).toEqual([]);
  });

  it("ignores semicolons inside literals, identifiers and dollar-quoted bodies", () => {
    expect(splitStatements(`SELECT 'a;b', "c;d";`)).toEqual([`SELECT 'a;b', "c;d"`]);
    expect(splitStatements(`SELECT 'it''s; fine';`)).toEqual([`SELECT 'it''s; fine'`]);
    expect(splitStatements("DO $$ BEGIN PERFORM 1; END $$;")).toEqual([
      "DO $$ BEGIN PERFORM 1; END $$",
    ]);
  });

  it("ignores semicolons inside block comments", () => {
    expect(splitStatements("SELECT 1 /* ; not a boundary */ ; SELECT 2;")).toEqual([
      "SELECT 1 /* ; not a boundary */",
      "SELECT 2",
    ]);
  });

  it("returns a trailing statement that has no terminating semicolon", () => {
    expect(splitStatements("SELECT 1")).toEqual(["SELECT 1"]);
  });
});

describe("readMigrations", () => {
  it("orders migrations by filename and flags the ones that opt out of a transaction", async () => {
    const migrations = await readMigrations();
    const filenames = migrations.map((migration) => migration.filename);

    expect(filenames).toEqual([...filenames].sort());
    expect(filenames[0]).toBe("001_initial.sql");
    expect(migrations.every((migration) => /^[0-9a-f]{64}$/.test(migration.checksum))).toBe(true);

    const concurrentIndexes = migrations.find((migration) => migration.filename === "010_add_event_geo_indexes.sql");
    expect(concurrentIndexes?.transactional).toBe(false);
    expect(migrations.find((migration) => migration.filename === "001_initial.sql")?.transactional).toBe(true);
  });

  it("never reuses a migration number", async () => {
    const numbers = (await readMigrations()).map((migration) => migration.filename.slice(0, 3));
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
