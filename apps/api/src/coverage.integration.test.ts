import { registerCollectionRegions } from "@town-map/db";
import type { CoverageResponse } from "@town-map/contracts";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = connectionString ? describe : describe.skip;
const schema = `town_map_coverage_api_test_${process.pid}`;

vi.mock("@clerk/fastify", () => ({
  clerkPlugin: async () => {},
  getAuth: () => ({ isAuthenticated: false, userId: null }),
  clerkClient: { users: { updateUserMetadata: vi.fn().mockResolvedValue({}) } },
}));

let app: Awaited<ReturnType<typeof import("./app.js").createApp>>;
let client: Client;

const YGO_SOURCE = "konami-kcgn";
const RIFTBOUND_SOURCE = "riftbound-locator";

function sourceCoverage(body: CoverageResponse, source: string) {
  return body.sources.find((entry) => entry.source === source);
}

function regionKeys(body: CoverageResponse, source: string) {
  return body.regions.filter((region) => region.source === source).map((region) => region.key);
}

integration("/v1/coverage live path", () => {
  beforeAll(async () => {
    client = new Client({ connectionString });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    const { applyMigrations } = await import("@town-map/db/migrations");
    await applyMigrations(client);

    const url = new URL(connectionString!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();

    app = await (await import("./app.js")).createApp();
  }, 60_000);

  beforeEach(async () => {
    await client.query("TRUNCATE TABLE collection_regions CASCADE");
  });

  afterAll(async () => {
    await app?.close();
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  });

  it("fails if YGO or Riftbound is still one region", async () => {
    await registerCollectionRegions(YGO_SOURCE, [
      { key: "US:IL", label: "United States — IL", countryCode: "US", config: { stateCode: "IL" } },
      { key: "US:CA", label: "United States — CA", countryCode: "US", config: { stateCode: "CA" } },
      { key: "US:NY", label: "United States — NY", countryCode: "US", config: { stateCode: "NY" } },
    ], client);
    await registerCollectionRegions(RIFTBOUND_SOURCE, [
      { key: "us-il-chicago", label: "Chicago", countryCode: "US", config: { latitude: 41.8781, longitude: -87.6298, radiusMiles: 100 } },
      { key: "us-ca-la", label: "Los Angeles", countryCode: "US", config: { latitude: 34.0522, longitude: -118.2437, radiusMiles: 100 } },
      { key: "us-ny-nyc", label: "New York", countryCode: "US", config: { latitude: 40.7128, longitude: -74.006, radiusMiles: 100 } },
    ], client);

    const response = await app.inject({ method: "GET", url: "/v1/coverage" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as CoverageResponse;

    const ygo = sourceCoverage(body, YGO_SOURCE);
    const riftbound = sourceCoverage(body, RIFTBOUND_SOURCE);
    expect(ygo).toBeDefined();
    expect(riftbound).toBeDefined();
    expect(ygo!.totalRegions).toBeGreaterThan(1);
    expect(ygo!.enabledRegions).toBeGreaterThan(1);
    expect(riftbound!.totalRegions).toBeGreaterThan(1);
    expect(riftbound!.enabledRegions).toBeGreaterThan(1);
    expect(regionKeys(body, YGO_SOURCE)).not.toEqual(["US:IL"]);
    expect(new Set(regionKeys(body, YGO_SOURCE)).size).toBeGreaterThan(1);
    expect(new Set(regionKeys(body, RIFTBOUND_SOURCE)).size).toBeGreaterThan(1);
  });

  it("reports the one-region shape the lock forbids", async () => {
    await registerCollectionRegions(YGO_SOURCE, [
      { key: "US:IL", label: "United States — IL", countryCode: "US", config: { stateCode: "IL" } },
    ], client);
    await registerCollectionRegions(RIFTBOUND_SOURCE, [
      { key: "us-il-chicago", label: "Chicago", countryCode: "US", config: { latitude: 41.8781, longitude: -87.6298, radiusMiles: 100 } },
    ], client);

    const response = await app.inject({ method: "GET", url: "/v1/coverage" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as CoverageResponse;
    expect(sourceCoverage(body, YGO_SOURCE)).toMatchObject({ totalRegions: 1, enabledRegions: 1 });
    expect(sourceCoverage(body, RIFTBOUND_SOURCE)).toMatchObject({ totalRegions: 1, enabledRegions: 1 });
    expect(regionKeys(body, YGO_SOURCE)).toEqual(["US:IL"]);
  });
});
