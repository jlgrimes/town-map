import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = connectionString ? describe : describe.skip;
const schema = `town_map_events_api_test_${process.pid}`;

vi.mock("@clerk/fastify", () => ({
  clerkPlugin: async () => {},
  getAuth: () => ({ isAuthenticated: false, userId: null }),
  clerkClient: { users: { updateUserMetadata: vi.fn().mockResolvedValue({}) } },
}));

let app: Awaited<ReturnType<typeof import("./app.js").createApp>>;
let client: Client;

const ALL_GAMES = ["pokemon", "magic", "yugioh", "onepiece", "riftbound"] as const;
const CHICAGO = { latitude: 41.8781, longitude: -87.6298 };
const SAN_FRANCISCO = { latitude: 37.7749, longitude: -122.4194 };

async function createLocatedEvent(
  game: string,
  sourceEventId: string,
  latitude: number,
  longitude: number,
  title: string,
  format: string | null = null,
) {
  const venue = await client.query<{ id: string }>(
    `INSERT INTO venues (source, source_venue_id, name, latitude, longitude)
     VALUES ('wotc-locator', $1, $2, $3, $4)
     RETURNING id`,
    [sourceEventId, title, latitude, longitude],
  );
  const event = await client.query<{ id: string }>(
    `INSERT INTO events (source, source_event_id, game, venue_id, title, starts_at, source_url, latitude, longitude, format)
     VALUES ('wotc-locator', $1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      sourceEventId,
      game,
      venue.rows[0].id,
      title,
      "2035-06-01T19:00:00.000Z",
      `https://example.com/${sourceEventId}`,
      latitude,
      longitude,
      format,
    ],
  );
  return event.rows[0].id;
}

async function listEvents(query: string) {
  return app.inject({ method: "GET", url: `/v1/events?${query}` });
}

function chicagoMagicQuery() {
  return `games=magic&latitude=${CHICAGO.latitude}&longitude=${CHICAGO.longitude}&radiusMiles=25&limit=50`;
}

integration("/v1/events live path", () => {
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
    await client.query("DELETE FROM venues");
  });

  afterAll(async () => {
    await app?.close();
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  });

  it("returns every game from one spatial query, never a second region", async () => {
    for (const game of ALL_GAMES) {
      await createLocatedEvent(game, `chi-${game}`, CHICAGO.latitude, CHICAGO.longitude, `Chicago ${game}`);
    }
    await createLocatedEvent("magic", "sf-magic", SAN_FRANCISCO.latitude, SAN_FRANCISCO.longitude, "SF Magic");

    const response = await listEvents(
      `games=${ALL_GAMES.join(",")}&latitude=${CHICAGO.latitude}&longitude=${CHICAGO.longitude}&radiusMiles=25&limit=50`,
    );

    expect(response.statusCode).toBe(200);
    const body = response.json() as { events: Array<{ game: string; title: string }>; nextCursor: string | null };
    expect(body.nextCursor).toBeNull();
    expect(body.events.map((event) => event.game).sort()).toEqual([...ALL_GAMES].sort());
    expect(body.events.map((event) => event.title)).not.toContain("SF Magic");
  });

  it("does not leak other games when one game is selected", async () => {
    await createLocatedEvent("magic", "chi-magic", CHICAGO.latitude, CHICAGO.longitude, "Chicago magic");
    await createLocatedEvent("yugioh", "chi-ygo", CHICAGO.latitude, CHICAGO.longitude, "Chicago yugioh");

    const response = await listEvents(
      `games=magic&latitude=${CHICAGO.latitude}&longitude=${CHICAGO.longitude}&radiusMiles=25`,
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().events.map((event: { game: string }) => event.game)).toEqual(["magic"]);
  });

  it("rejects an unknown game instead of silently dropping it", async () => {
    const response = await listEvents("games=chess");
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/Unknown game/);
  });

  it("puts Standard, Modern, Pioneer, Draft, and Sealed on the payload, never Constructed", async () => {
    await createLocatedEvent("magic", "chi-standard", CHICAGO.latitude, CHICAGO.longitude, "Friday Night Magic Standard", "Constructed");
    await createLocatedEvent("magic", "chi-modern", CHICAGO.latitude, CHICAGO.longitude, "Modern FNM", "Constructed");
    await createLocatedEvent("magic", "chi-pioneer", CHICAGO.latitude, CHICAGO.longitude, "Pioneer Challenge", "Constructed");
    await createLocatedEvent("magic", "chi-draft", CHICAGO.latitude, CHICAGO.longitude, "Chicago Draft Night", "Booster Draft");
    await createLocatedEvent("magic", "chi-sealed", CHICAGO.latitude, CHICAGO.longitude, "Chicago Prerelease", "Sealed Deck");
    await createLocatedEvent("magic", "chi-constructed", CHICAGO.latitude, CHICAGO.longitude, "Chicago FNM", "Constructed");
    await createLocatedEvent("magic", "chi-commander", CHICAGO.latitude, CHICAGO.longitude, "Commander Night", "Commander");
    await createLocatedEvent("magic", "sf-standard", SAN_FRANCISCO.latitude, SAN_FRANCISCO.longitude, "SF Standard Night", "Constructed");

    const response = await listEvents(chicagoMagicQuery());
    expect(response.statusCode).toBe(200);
    const body = response.json() as { events: Array<{ title: string; format: string | null }>; nextCursor: string | null };
    expect(body.nextCursor).toBeNull();

    const byTitle = Object.fromEntries(body.events.map((event) => [event.title, event.format]));
    expect(byTitle["Friday Night Magic Standard"]).toBe("Standard");
    expect(byTitle["Modern FNM"]).toBe("Modern");
    expect(byTitle["Pioneer Challenge"]).toBe("Pioneer");
    expect(byTitle["Chicago Draft Night"]).toBe("Draft");
    expect(byTitle["Chicago Prerelease"]).toBe("Sealed");
    expect(byTitle["Chicago FNM"]).toBeNull();
    expect(byTitle["Commander Night"]).toBe("Commander");
    expect(byTitle["SF Standard Night"]).toBeUndefined();
    expect(body.events.some((event) => event.format === "Constructed")).toBe(false);
    expect(body.events.some((event) => event.format === "Booster Draft")).toBe(false);
    expect(body.events.some((event) => event.format === "Sealed Deck")).toBe(false);
  });
});
