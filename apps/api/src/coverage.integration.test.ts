import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoverageResponse, CoverageSource } from "@town-map/contracts";
import { registerCollectionRegions } from "@town-map/db";

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

const YGO = "konami-kcgn";
const RIFTBOUND = "riftbound-locator";
const ONE_PIECE = "bandai-tcg-plus";

const nationalYgo = [
  { key: "US:IL", label: "Illinois", countryCode: "US", config: { stateCode: "IL" } },
  { key: "US:CA", label: "California", countryCode: "US", config: { stateCode: "CA" } },
  { key: "US:NY", label: "New York", countryCode: "US", config: { stateCode: "NY" } },
];

const nationalRiftbound = [
  { key: "us-il-chicago", label: "Chicago, IL", countryCode: "US", config: { latitude: 41.8781, longitude: -87.6298 } },
  { key: "us-ca-la", label: "Los Angeles, CA", countryCode: "US", config: { latitude: 34.0522, longitude: -118.2437 } },
  { key: "us-ny-nyc", label: "New York, NY", countryCode: "US", config: { latitude: 40.7128, longitude: -74.006 } },
];

const illinoisOnePiece = [
  { key: "US:US-IL", label: "United States — IL", countryCode: "US", config: { countryCode: "US", prefCodes: ["US-IL"] } },
];

const nationalOnePiece = [
  { key: "US", label: "United States", countryCode: "US", config: { countryCode: "US" } },
];

async function getCoverage() {
  return app.inject({ method: "GET", url: "/v1/coverage" });
}

function sourceCoverage(body: CoverageResponse, source: string): CoverageSource {
  const found = body.sources.find((entry) => entry.source === source);
  expect(found).toBeDefined();
  return found!;
}

function uniqueRegionKeys(body: CoverageResponse, source: string) {
  return [...new Set(body.regions.filter((region) => region.source === source).map((region) => region.key))].sort();
}

function regionLabels(body: CoverageResponse, source: string) {
  return body.regions.filter((region) => region.source === source).map((region) => region.label);
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
    await client.query("DELETE FROM events");
    await client.query("DELETE FROM sync_runs");
    await client.query("DELETE FROM collection_regions");
  });

  afterAll(async () => {
    await app?.close();
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  });

  it("fails if YGO or Riftbound coverage is still one region", async () => {
    await registerCollectionRegions(YGO, nationalYgo, client);
    await registerCollectionRegions(RIFTBOUND, nationalRiftbound, client);

    const response = await getCoverage();
    expect(response.statusCode).toBe(200);
    const body = response.json() as CoverageResponse;

    for (const source of [YGO, RIFTBOUND]) {
      const coverage = sourceCoverage(body, source);
      expect(coverage.totalRegions).toBeGreaterThan(1);
      expect(coverage.enabledRegions).toBeGreaterThan(1);
    }

    expect(uniqueRegionKeys(body, YGO)).not.toEqual(["US:IL"]);
    expect(uniqueRegionKeys(body, RIFTBOUND)).not.toEqual(["us-il-chicago"]);
  });

  it("documents the one-region shape the lock test forbids", async () => {
    await registerCollectionRegions(YGO, [nationalYgo[0]], client);
    await registerCollectionRegions(RIFTBOUND, [nationalRiftbound[0]], client);

    const response = await getCoverage();
    expect(response.statusCode).toBe(200);
    const body = response.json() as CoverageResponse;

    const ygo = sourceCoverage(body, YGO);
    expect(ygo.totalRegions).toBe(1);
    expect(ygo.enabledRegions).toBe(1);

    const riftbound = sourceCoverage(body, RIFTBOUND);
    expect(riftbound.totalRegions).toBe(1);
    expect(riftbound.enabledRegions).toBe(1);
  });

  it("fails if One Piece coverage is still Illinois", async () => {
    await registerCollectionRegions(ONE_PIECE, nationalOnePiece, client);

    const response = await getCoverage();
    expect(response.statusCode).toBe(200);
    const body = response.json() as CoverageResponse;

    const coverage = sourceCoverage(body, ONE_PIECE);
    expect(coverage.enabledRegions).toBeGreaterThan(0);
    expect(uniqueRegionKeys(body, ONE_PIECE)).not.toEqual(["US:US-IL"]);
    expect(regionLabels(body, ONE_PIECE).some((label) => /Illinois/i.test(label))).toBe(false);
    expect(body.regions.filter((region) => region.source === ONE_PIECE).every((region) => region.countryCode === "US")).toBe(true);
  });

  it("documents the Illinois-only One Piece shape the lock forbids", async () => {
    await registerCollectionRegions(ONE_PIECE, illinoisOnePiece, client);

    const response = await getCoverage();
    expect(response.statusCode).toBe(200);
    const body = response.json() as CoverageResponse;

    const coverage = sourceCoverage(body, ONE_PIECE);
    expect(coverage.totalRegions).toBe(1);
    expect(coverage.enabledRegions).toBe(1);
    expect(uniqueRegionKeys(body, ONE_PIECE)).toEqual(["US:US-IL"]);
    expect(regionLabels(body, ONE_PIECE).some((label) => /\bIL\b/.test(label))).toBe(true);
  });
});
