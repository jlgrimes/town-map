import type { NormalizedEvent } from "@town-map/contracts";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrations.js";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = connectionString ? describe : describe.skip;
const schema = `town_map_search_test_${process.pid}`;

let client: Client;
let closePool: typeof import("./index.js").closePool;
let listEvents: typeof import("./index.js").listEvents;
let upsertEvents: typeof import("./index.js").upsertEvents;

/** Chicago, so the spatial path has somewhere real to centre on. */
const origin = { latitude: 41.8781, longitude: -87.6298 };

function event(overrides: Partial<NormalizedEvent> & Pick<NormalizedEvent, "sourceEventId">): NormalizedEvent {
  return {
    sourceSeriesId: null,
    game: "magic",
    title: "Event",
    description: null,
    startsAt: "2030-03-01T23:00:00.000Z",
    endsAt: null,
    timezone: "America/Chicago",
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
    raw: {},
    ...overrides,
  };
}

function venue(overrides: Partial<NormalizedEvent["venue"]> & { sourceVenueId: string; name: string }) {
  return {
    address: null,
    city: "Chicago",
    region: "IL",
    postalCode: null,
    country: "US",
    latitude: 41.88,
    longitude: -87.63,
    website: null,
    phone: null,
    ...overrides,
  };
}

integration("free-text event search", () => {
  beforeAll(async () => {
    client = new Client({ connectionString });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    await applyMigrations(client);

    // upsertEvents uses the module-level pool, so point it at the same schema.
    const url = new URL(connectionString!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    ({ closePool, listEvents, upsertEvents } = await import("./index.js"));

    await upsertEvents("wotc-locator", [
      event({
        sourceEventId: "fnm-1",
        title: "Friday Night Magic",
        format: "Modern",
        eventType: "tournament",
        venue: venue({ sourceVenueId: "dice-tower", name: "The Dice Tower", address: "12 Clark Street" }),
      }),
      event({
        sourceEventId: "prerelease-1",
        game: "pokemon",
        title: "Prerelease Weekend",
        format: "Standard",
        eventType: "prerelease",
        startsAt: "2030-03-02T16:00:00.000Z",
        venue: venue({ sourceVenueId: "card-barn", name: "Card Barn", address: "400 Halsted Street" }),
      }),
    ]);
  }, 60_000);

  afterAll(async () => {
    await closePool?.();
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  });

  async function search(q: string | undefined) {
    const page = await listEvents({
      games: [],
      q,
      from: "2030-01-01T00:00:00.000Z",
      ...origin,
      radiusMiles: 25,
      limit: 50,
    });
    return page.events.map((found) => found.title).sort();
  }

  it("matches words in any order, which a substring match could not", async () => {
    // The client-side filter this replaced tested `includes("friday magic")`
    // against a joined string, so word order alone decided the result.
    await expect(search("friday magic")).resolves.toEqual(["Friday Night Magic"]);
    await expect(search("magic friday")).resolves.toEqual(["Friday Night Magic"]);
  });

  it("matches the venue, address and format copied onto the event", async () => {
    await expect(search("dice tower")).resolves.toEqual(["Friday Night Magic"]);
    await expect(search("halsted")).resolves.toEqual(["Prerelease Weekend"]);
    await expect(search("modern")).resolves.toEqual(["Friday Night Magic"]);
    await expect(search("chicago")).resolves.toEqual(["Friday Night Magic", "Prerelease Weekend"]);
  });

  it("stems, so a plural finds the singular it was indexed as", async () => {
    await expect(search("tournaments")).resolves.toEqual(["Friday Night Magic"]);
  });

  it("requires every term, rather than any of them", async () => {
    await expect(search("magic barn")).resolves.toEqual([]);
  });

  it("honours quoted phrases and exclusions", async () => {
    await expect(search('"friday night"')).resolves.toEqual(["Friday Night Magic"]);
    await expect(search("chicago -magic")).resolves.toEqual(["Prerelease Weekend"]);
  });

  it("returns everything for a query with no searchable term", async () => {
    // "the" is a stop word, so it parses to an empty tsquery. Treating that as
    // "match nothing" would empty the list for a query nobody meant as a filter.
    await expect(search("the")).resolves.toEqual(["Friday Night Magic", "Prerelease Weekend"]);
    await expect(search(undefined)).resolves.toEqual(["Friday Night Magic", "Prerelease Weekend"]);
  });

  it("finds nothing for a term that appears in no event", async () => {
    await expect(search("yugioh")).resolves.toEqual([]);
  });

  it("serves the filter from the expression index rather than scanning", async () => {
    // Guards the thing a comment cannot: that the expression in the query still
    // matches the expression migration 020 indexed. They are separate strings in
    // separate files, and a drift between them costs the index silently — the
    // results stay correct and every assertion above still passes.
    //
    // Seeded in the Southern Ocean and never mentioning a term the assertions
    // above search for, so the corpus the planner needs cannot reach them: every
    // other test here is bounded to 25 miles of Chicago.
    await client.query(`
      INSERT INTO events (source, source_event_id, game, title, starts_at, latitude, longitude, search_text)
      SELECT 'wotc-locator', 'filler-' || value, 'magic', 'Filler ' || value,
        timestamptz '2030-06-01 12:00:00+00', -60.0, 40.0, 'filler sundry gathering ' || value
      FROM generate_series(1, 5000) AS value`);
    await client.query("ANALYZE events");

    const plan = await client.query<Record<"QUERY PLAN", string>>(
      `EXPLAIN SELECT id FROM events e
       WHERE e.withdrawn_at IS NULL
         AND to_tsvector('english', coalesce(e.search_text, '')) @@ websearch_to_tsquery('english', $1)`,
      ["magic"],
    );

    expect(plan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain("events_search_text_idx");
  });
});
