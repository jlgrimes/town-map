import type { NormalizedEvent } from "@town-map/contracts";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrations.js";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = connectionString ? describe : describe.skip;
const schema = `town_map_retention_test_${process.pid}`;

let client: Client;
let closePool: typeof import("./index.js").closePool;
let upsertEvents: typeof import("./index.js").upsertEvents;
let deleteExpiredEvents: typeof import("./index.js").deleteExpiredEvents;

function event(id: string, startsAt: string, raw: unknown = { id }): NormalizedEvent {
  return {
    sourceEventId: id,
    sourceSeriesId: null,
    game: "magic",
    title: `Event ${id}`,
    description: null,
    startsAt,
    endsAt: null,
    timezone: null,
    status: null,
    format: null,
    eventType: null,
    sourceUrl: null,
    registrationUrl: null,
    priceAmount: null,
    priceCurrency: null,
    capacity: null,
    isOnline: false,
    venue: null,
    raw,
  };
}

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

integration("event retention", () => {
  beforeAll(async () => {
    client = new Client({ connectionString });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    await applyMigrations(client);

    const url = new URL(connectionString!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    ({ closePool, upsertEvents, deleteExpiredEvents } = await import("./index.js"));
  }, 60_000);

  beforeEach(async () => {
    await client.query("DELETE FROM events");
  });

  afterAll(async () => {
    await closePool?.();
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  });

  it("removes events older than the window and keeps everything newer", async () => {
    await upsertEvents("wotc-locator", [
      event("ancient", daysFromNow(-400)),
      event("recent", daysFromNow(-10)),
      event("upcoming", daysFromNow(30)),
    ]);

    await expect(deleteExpiredEvents(365)).resolves.toEqual({ deleted: 1, skipped: false });

    const remaining = await client.query<{ sourceEventId: string }>(
      `SELECT source_event_id AS "sourceEventId" FROM events ORDER BY source_event_id`,
    );
    expect(remaining.rows.map((row) => row.sourceEventId)).toEqual(["recent", "upcoming"]);
  });

  it("cascades to the raw payloads so they cannot outlive their event", async () => {
    await upsertEvents("wotc-locator", [event("ancient", daysFromNow(-400))]);
    const before = await client.query<{ count: string }>("SELECT count(*)::text FROM event_raw");
    expect(before.rows[0].count).toBe("1");

    await deleteExpiredEvents(365);

    const after = await client.query<{ count: string }>("SELECT count(*)::text FROM event_raw");
    expect(after.rows[0].count).toBe("0");
  });

  it("deletes across batch boundaries", async () => {
    await upsertEvents("wotc-locator", Array.from({ length: 25 }, (_, index) =>
      event(`old-${index}`, daysFromNow(-400 - index))));

    await expect(deleteExpiredEvents(365, { batchSize: 10 })).resolves.toEqual({
      deleted: 25,
      skipped: false,
    });

    const remaining = await client.query<{ count: string }>("SELECT count(*)::text FROM events");
    expect(remaining.rows[0].count).toBe("0");
  });

  it("skips rather than running twice concurrently", async () => {
    const other = new Client({ connectionString });
    await other.connect();
    await other.query(`SET search_path TO ${schema}, public`);
    await other.query("SELECT pg_advisory_lock(8042027)");
    try {
      await expect(deleteExpiredEvents(365)).resolves.toEqual({ deleted: 0, skipped: true });
    } finally {
      await other.query("SELECT pg_advisory_unlock(8042027)");
      await other.end();
    }
  });

  it("rejects a window that would delete upcoming events", async () => {
    await expect(deleteExpiredEvents(0)).rejects.toThrow(/positive integer/);
    await expect(deleteExpiredEvents(-1)).rejects.toThrow(/positive integer/);
  });

  describe("raw payload storage", () => {
    it("stores the payload outside the events table", async () => {
      await upsertEvents("wotc-locator", [event("with-raw", daysFromNow(10), { upstream: "payload" })]);

      const columns = await client.query<{ count: string }>(
        `SELECT count(*)::text FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'events' AND column_name = 'raw'`,
        [schema],
      );
      expect(columns.rows[0].count).toBe("0");

      const stored = await client.query<{ raw: unknown }>(
        `SELECT r.raw FROM event_raw r
         JOIN events e ON e.id = r.event_id
         WHERE e.source_event_id = 'with-raw'`,
      );
      expect(stored.rows[0].raw).toEqual({ upstream: "payload" });
    });

    it("leaves the payload untouched when it has not changed", async () => {
      await upsertEvents("wotc-locator", [event("stable", daysFromNow(10), { upstream: "v1" })]);
      const before = await client.query<{ updatedAt: Date }>(
        `SELECT r.updated_at AS "updatedAt" FROM event_raw r
         JOIN events e ON e.id = r.event_id WHERE e.source_event_id = 'stable'`,
      );

      await upsertEvents("wotc-locator", [event("stable", daysFromNow(10), { upstream: "v1" })]);

      const after = await client.query<{ updatedAt: Date }>(
        `SELECT r.updated_at AS "updatedAt" FROM event_raw r
         JOIN events e ON e.id = r.event_id WHERE e.source_event_id = 'stable'`,
      );
      expect(after.rows[0].updatedAt).toEqual(before.rows[0].updatedAt);
    });

    it("updates the payload when the upstream record changes", async () => {
      await upsertEvents("wotc-locator", [event("moving", daysFromNow(10), { upstream: "v1" })]);
      await upsertEvents("wotc-locator", [event("moving", daysFromNow(10), { upstream: "v2" })]);

      const stored = await client.query<{ raw: unknown }>(
        `SELECT r.raw FROM event_raw r
         JOIN events e ON e.id = r.event_id WHERE e.source_event_id = 'moving'`,
      );
      expect(stored.rows[0].raw).toEqual({ upstream: "v2" });
    });
  });
});
