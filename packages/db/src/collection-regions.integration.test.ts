import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  beginSync,
  claimNextCollectionRegion,
  finishCollectionRegion,
  finishSync,
  registerCollectionRegions,
} from "./index.js";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = connectionString ? describe : describe.skip;
const schema = `town_map_regions_test_${process.pid}`;
const migrationsDirectory = fileURLToPath(new URL("../migrations", import.meta.url));
let firstClient: Client;
let secondClient: Client;

integration("regional collection leases", () => {
  beforeAll(async () => {
    firstClient = new Client({ connectionString });
    secondClient = new Client({ connectionString });
    await Promise.all([firstClient.connect(), secondClient.connect()]);
    await firstClient.query(`CREATE SCHEMA ${schema}`);
    await Promise.all([
      firstClient.query(`SET search_path TO ${schema}, public`),
      secondClient.query(`SET search_path TO ${schema}, public`),
    ]);
    await firstClient.query("SELECT pg_advisory_lock(8042026)");
    try {
      for (const migration of [
        "001_initial.sql",
        "002_add_source_url.sql",
        "003_add_spatial_query_indexes.sql",
        "004_add_collection_regions.sql",
        "005_add_user_preferences.sql",
      ]) {
        await firstClient.query(await readFile(`${migrationsDirectory}/${migration}`, "utf8"));
      }
    } finally {
      await firstClient.query("SELECT pg_advisory_unlock(8042026)");
    }
  });

  afterAll(async () => {
    if (!firstClient || !secondClient) return;
    await firstClient.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await Promise.all([firstClient.end(), secondClient.end()]);
  });

  it("atomically gives concurrent workers different due regions", async () => {
    await registerCollectionRegions("wotc-locator", [
      { key: "us-il", label: "Illinois", countryCode: "US", config: { latitude: 41.8 }, priority: 10 },
      { key: "us-wi", label: "Wisconsin", countryCode: "US", config: { latitude: 43.0 }, priority: 20 },
    ], firstClient);

    const [first, second] = await Promise.all([
      claimNextCollectionRegion("wotc-locator", "worker-a", 30, firstClient),
      claimNextCollectionRegion("wotc-locator", "worker-b", 30, secondClient),
    ]);

    expect(new Set([first?.key, second?.key])).toEqual(new Set(["us-il", "us-wi"]));
    const syncId = await beginSync("wotc-locator", first!, firstClient);
    await finishSync(syncId, { status: "succeeded", eventsSeen: 12, eventsWritten: 12 }, firstClient);
    await finishCollectionRegion(first!.id, "worker-a", { status: "succeeded" }, firstClient);
    await finishCollectionRegion(second!.id, "worker-b", { status: "failed", error: "upstream timeout", retryMinutes: 15 }, secondClient);

    const state = await firstClient.query<{
      regionKey: string;
      leaseOwner: string | null;
      lastSuccessAt: Date | null;
      lastFailureAt: Date | null;
      lastError: string | null;
    }>(`SELECT region_key AS "regionKey", lease_owner AS "leaseOwner",
        last_success_at AS "lastSuccessAt", last_failure_at AS "lastFailureAt", last_error AS "lastError"
      FROM collection_regions ORDER BY region_key`);
    expect(state.rows.every((region) => region.leaseOwner === null)).toBe(true);
    expect(state.rows.find((region) => region.regionKey === first!.key)?.lastSuccessAt).toBeInstanceOf(Date);
    expect(state.rows.find((region) => region.regionKey === second!.key)).toMatchObject({ lastError: "upstream timeout" });

    const sync = await firstClient.query<{ regionKey: string; status: string }>(
      `SELECT region_key AS "regionKey", status FROM sync_runs WHERE id = $1`,
      [syncId],
    );
    expect(sync.rows[0]).toEqual({ regionKey: first!.key, status: "succeeded" });
  });

  it("allows another worker to recover an expired lease", async () => {
    await registerCollectionRegions("konami-kcgn", [
      { key: "US:IL", label: "Illinois", countryCode: "US", config: { stateCode: "IL" } },
    ], firstClient);
    const original = await claimNextCollectionRegion("konami-kcgn", "worker-crashed", 30, firstClient);
    expect(original?.key).toBe("US:IL");
    await firstClient.query(
      "UPDATE collection_regions SET lease_expires_at = now() - interval '1 minute' WHERE id = $1",
      [original!.id],
    );

    const recovered = await claimNextCollectionRegion("konami-kcgn", "worker-recovery", 30, secondClient);
    expect(recovered?.id).toBe(original?.id);
    await finishCollectionRegion(recovered!.id, "worker-recovery", { status: "succeeded" }, secondClient);
  });

  it("disables regions removed from the source configuration", async () => {
    await registerCollectionRegions("pokedata-events", [
      { key: "US", label: "United States", countryCode: "US", config: { country: "US" } },
      { key: "CA", label: "Canada", countryCode: "CA", config: { country: "CA" } },
    ], firstClient);
    await registerCollectionRegions("pokedata-events", [
      { key: "US", label: "United States", countryCode: "US", config: { country: "US" } },
    ], firstClient);

    const regions = await firstClient.query<{ regionKey: string; enabled: boolean }>(
      `SELECT region_key AS "regionKey", enabled
       FROM collection_regions
       WHERE source = 'pokedata-events'
       ORDER BY region_key`,
    );
    expect(regions.rows).toEqual([
      { regionKey: "CA", enabled: false },
      { regionKey: "US", enabled: true },
    ]);
  });
});
