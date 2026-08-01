import type { EventListItem, EventPage, EventQuery, EventSource, NormalizedEvent } from "@town-map/contracts";
import { Pool, type PoolClient } from "pg";

let pool: Pool | undefined;

export function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  pool ??= new Pool({ connectionString, max: 10 });
  return pool;
}

export async function closePool() {
  await pool?.end();
  pool = undefined;
}

export async function beginSync(source: EventSource): Promise<string> {
  const result = await getPool().query<{ id: string }>(
    "INSERT INTO sync_runs (source) VALUES ($1) RETURNING id",
    [source],
  );
  return result.rows[0].id;
}

export async function finishSync(
  id: string,
  values: { status: "succeeded" | "failed"; eventsSeen: number; eventsWritten: number; error?: string },
) {
  await getPool().query(
    `UPDATE sync_runs
     SET status = $2, events_seen = $3, events_written = $4, error_message = $5, finished_at = now()
     WHERE id = $1`,
    [id, values.status, values.eventsSeen, values.eventsWritten, values.error ?? null],
  );
}

async function upsertVenue(client: PoolClient, source: EventSource, event: NormalizedEvent) {
  if (!event.venue) return null;
  const venue = event.venue;
  const result = await client.query<{ id: string }>(
    `INSERT INTO venues (
       source, source_venue_id, name, address, city, region, postal_code, country,
       latitude, longitude, website, phone
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (source, source_venue_id) DO UPDATE SET
       name = EXCLUDED.name, address = EXCLUDED.address, city = EXCLUDED.city,
       region = EXCLUDED.region, postal_code = EXCLUDED.postal_code,
       country = EXCLUDED.country, latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude, website = EXCLUDED.website,
       phone = EXCLUDED.phone, updated_at = now()
     RETURNING id`,
    [
      source, venue.sourceVenueId, venue.name, venue.address, venue.city, venue.region,
      venue.postalCode, venue.country, venue.latitude, venue.longitude, venue.website, venue.phone,
    ],
  );
  return result.rows[0].id;
}

export async function upsertEvent(source: EventSource, event: NormalizedEvent) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const venueId = await upsertVenue(client, source, event);
    await client.query(
      `INSERT INTO events (
         source, source_event_id, game, venue_id, title, description, starts_at, ends_at,
         timezone, status, format, event_type, source_url, registration_url, price_amount,
         price_currency, capacity, is_online, raw
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (source, source_event_id) DO UPDATE SET
         game = EXCLUDED.game, venue_id = EXCLUDED.venue_id, title = EXCLUDED.title,
         description = EXCLUDED.description, starts_at = EXCLUDED.starts_at,
         ends_at = EXCLUDED.ends_at, timezone = EXCLUDED.timezone, status = EXCLUDED.status,
         format = EXCLUDED.format, event_type = EXCLUDED.event_type,
         source_url = EXCLUDED.source_url, registration_url = EXCLUDED.registration_url,
         price_amount = EXCLUDED.price_amount,
         price_currency = EXCLUDED.price_currency, capacity = EXCLUDED.capacity,
         is_online = EXCLUDED.is_online, raw = EXCLUDED.raw,
         last_seen_at = now(), updated_at = now()`,
      [
        source, event.sourceEventId, event.game, venueId, event.title, event.description,
        event.startsAt, event.endsAt, event.timezone, event.status, event.format,
        event.eventType, event.sourceUrl, event.registrationUrl, event.priceAmount, event.priceCurrency,
        event.capacity, event.isOnline, JSON.stringify(event.raw),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

type EventRow = Omit<EventListItem, "distanceMiles" | "venue"> & {
  distanceMeters: number | null;
  priceAmount: string | null;
  venueName: string | null;
  venueAddress: string | null;
  venueCity: string | null;
  venueRegion: string | null;
  venuePostalCode: string | null;
  venueLatitude: number | null;
  venueLongitude: number | null;
  venueWebsite: string | null;
};

type EventCursor = {
  version: 1;
  kind: "spatial" | "chronological";
  scope: string;
  snapshotFrom: string;
  startsAt: string;
  id: string;
  distanceMeters?: number;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METERS_PER_MILE = 1609.344;

export class InvalidEventCursorError extends Error {
  constructor() {
    super("The event cursor is invalid or does not match this query");
    this.name = "InvalidEventCursorError";
  }
}

function encodeCursor(cursor: EventCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined, expectedKind: EventCursor["kind"], expectedScope: string): EventCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<EventCursor>;
    const validDistance = expectedKind === "chronological"
      ? parsed.distanceMeters === undefined
      : typeof parsed.distanceMeters === "number" && Number.isFinite(parsed.distanceMeters) && parsed.distanceMeters >= 0;
    if (
      parsed.version !== 1
      || parsed.kind !== expectedKind
      || parsed.scope !== expectedScope
      || typeof parsed.snapshotFrom !== "string"
      || !Number.isFinite(Date.parse(parsed.snapshotFrom))
      || typeof parsed.startsAt !== "string"
      || !Number.isFinite(Date.parse(parsed.startsAt))
      || typeof parsed.id !== "string"
      || !UUID_PATTERN.test(parsed.id)
      || !validDistance
    ) throw new InvalidEventCursorError();
    return parsed as EventCursor;
  } catch (error) {
    if (error instanceof InvalidEventCursorError) throw error;
    throw new InvalidEventCursorError();
  }
}

function cursorScope(query: EventQuery) {
  return JSON.stringify({
    games: [...query.games].sort(),
    to: query.to ?? null,
    latitude: query.latitude ?? null,
    longitude: query.longitude ?? null,
    radiusMiles: query.latitude === undefined ? null : query.radiusMiles,
  });
}

const eventSelect = `
  e.id, e.source, e.source_event_id AS "sourceEventId", e.game, e.title,
  e.description, e.starts_at AS "startsAt", e.ends_at AS "endsAt",
  e.timezone, e.status, e.format, e.event_type AS "eventType",
  e.source_url AS "sourceUrl", e.registration_url AS "registrationUrl",
  e.price_amount AS "priceAmount",
  e.price_currency AS "priceCurrency", e.capacity, e.is_online AS "isOnline",
  v.name AS "venueName", v.address AS "venueAddress", v.city AS "venueCity",
  v.region AS "venueRegion", v.postal_code AS "venuePostalCode",
  v.latitude AS "venueLatitude", v.longitude AS "venueLongitude",
  v.website AS "venueWebsite"`;

function toEventListItem(row: EventRow): EventListItem {
  return {
    id: row.id,
    source: row.source,
    sourceEventId: row.sourceEventId,
    game: row.game,
    title: row.title,
    description: row.description,
    startsAt: new Date(row.startsAt).toISOString(),
    endsAt: row.endsAt ? new Date(row.endsAt).toISOString() : null,
    timezone: row.timezone,
    status: row.status,
    format: row.format,
    eventType: row.eventType,
    sourceUrl: row.sourceUrl,
    registrationUrl: row.registrationUrl,
    priceAmount: row.priceAmount === null ? null : Number(row.priceAmount),
    priceCurrency: row.priceCurrency,
    capacity: row.capacity,
    isOnline: row.isOnline,
    distanceMiles: row.distanceMeters === null ? null : Math.round((row.distanceMeters / METERS_PER_MILE) * 10) / 10,
    venue: row.venueName ? {
      name: row.venueName,
      address: row.venueAddress,
      city: row.venueCity,
      region: row.venueRegion,
      postalCode: row.venuePostalCode,
      latitude: row.venueLatitude,
      longitude: row.venueLongitude,
      website: row.venueWebsite,
    } : null,
  };
}

export async function listEvents(query: EventQuery, database: Pick<Pool, "query"> = getPool()): Promise<EventPage> {
  const spatial = query.latitude !== undefined && query.longitude !== undefined;
  const scope = cursorScope(query);
  const cursor = decodeCursor(query.cursor, spatial ? "spatial" : "chronological", scope);
  if (cursor && query.from && Date.parse(cursor.snapshotFrom) !== Date.parse(query.from)) {
    throw new InvalidEventCursorError();
  }
  const snapshotFrom = cursor?.snapshotFrom ?? query.from ?? new Date().toISOString();
  const values: unknown[] = [];
  const addValue = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const conditions = [`e.starts_at >= ${addValue(snapshotFrom)}`];
  if (query.to) {
    conditions.push(`e.starts_at <= ${addValue(query.to)}`);
  }
  if (query.games.length) {
    conditions.push(`e.game = ANY(${addValue(query.games)}::text[])`);
  }

  let sql: string;

  if (spatial) {
    const longitude = addValue(query.longitude);
    const latitude = addValue(query.latitude);
    const radiusMeters = addValue(query.radiusMiles * METERS_PER_MILE);
    conditions.push("v.location IS NOT NULL");
    conditions.push(`ST_DWithin(v.location, ST_Point(${longitude}, ${latitude}, 4326)::geography, ${radiusMeters})`);

    const cursorCondition = cursor
      ? `WHERE ("distanceMeters", "startsAt", id) > (${addValue(cursor.distanceMeters)}::double precision, ${addValue(cursor.startsAt)}::timestamptz, ${addValue(cursor.id)}::uuid)`
      : "";
    const limit = addValue(query.limit + 1);
    sql = `WITH candidates AS (
      SELECT ${eventSelect},
        ST_Distance(v.location, ST_Point(${longitude}, ${latitude}, 4326)::geography) AS "distanceMeters"
      FROM events e
      JOIN venues v ON v.id = e.venue_id
      WHERE ${conditions.join(" AND ")}
    )
    SELECT * FROM candidates
    ${cursorCondition}
    ORDER BY "distanceMeters" ASC, "startsAt" ASC, id ASC
    LIMIT ${limit}`;
  } else {
    if (cursor) {
      conditions.push(`(e.starts_at, e.id) > (${addValue(cursor.startsAt)}::timestamptz, ${addValue(cursor.id)}::uuid)`);
    }
    const limit = addValue(query.limit + 1);
    sql = `SELECT ${eventSelect}, NULL::double precision AS "distanceMeters"
      FROM events e
      LEFT JOIN venues v ON v.id = e.venue_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY e.starts_at ASC, e.id ASC
      LIMIT ${limit}`;
  }

  const result = await database.query<EventRow>(sql, values);
  const hasNextPage = result.rows.length > query.limit;
  const pageRows = result.rows.slice(0, query.limit);
  const lastRow = pageRows.at(-1);
  const nextCursor = hasNextPage && lastRow
    ? encodeCursor({
      version: 1,
      kind: spatial ? "spatial" : "chronological",
      scope,
      snapshotFrom,
      startsAt: new Date(lastRow.startsAt).toISOString(),
      id: lastRow.id,
      ...(spatial ? { distanceMeters: Number(lastRow.distanceMeters) } : {}),
    })
    : null;

  return {
    events: pageRows.map(toEventListItem),
    count: pageRows.length,
    nextCursor,
  };
}
