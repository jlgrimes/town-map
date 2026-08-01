import type { EventListItem, EventQuery, EventSource, NormalizedEvent } from "@town-map/contracts";
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

function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type EventRow = Omit<EventListItem, "distanceMiles" | "venue"> & {
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

export async function listEvents(query: EventQuery): Promise<EventListItem[]> {
  const values: unknown[] = [];
  const conditions = ["e.starts_at >= $1"];
  values.push(query.from ?? new Date().toISOString());
  if (query.to) {
    values.push(query.to);
    conditions.push(`e.starts_at <= $${values.length}`);
  }
  if (query.games.length) {
    values.push(query.games);
    conditions.push(`e.game = ANY($${values.length}::text[])`);
  }
  values.push(Math.max(query.limit * 8, 500));
  const result = await getPool().query<EventRow>(
    `SELECT
       e.id, e.source, e.source_event_id AS "sourceEventId", e.game, e.title,
       e.description, e.starts_at AS "startsAt", e.ends_at AS "endsAt",
       e.timezone, e.status, e.format, e.event_type AS "eventType",
       e.source_url AS "sourceUrl", e.registration_url AS "registrationUrl",
       e.price_amount AS "priceAmount",
       e.price_currency AS "priceCurrency", e.capacity, e.is_online AS "isOnline",
       v.name AS "venueName", v.address AS "venueAddress", v.city AS "venueCity",
       v.region AS "venueRegion", v.postal_code AS "venuePostalCode",
       v.latitude AS "venueLatitude", v.longitude AS "venueLongitude",
       v.website AS "venueWebsite"
     FROM events e
     LEFT JOIN venues v ON v.id = e.venue_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY e.starts_at ASC
     LIMIT $${values.length}`,
    values,
  );

  return result.rows
    .map((row) => {
      const canMeasure = query.latitude !== undefined && query.longitude !== undefined
        && row.venueLatitude !== null && row.venueLongitude !== null;
      const distance = canMeasure
        ? distanceMiles(query.latitude!, query.longitude!, row.venueLatitude!, row.venueLongitude!)
        : null;
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
        distanceMiles: distance === null ? null : Math.round(distance * 10) / 10,
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
      } satisfies EventListItem;
    })
    .filter((event) => event.distanceMiles === null || event.distanceMiles <= query.radiusMiles)
    .sort((a, b) => {
      if (a.distanceMiles !== null && b.distanceMiles !== null) return a.distanceMiles - b.distanceMiles;
      return a.startsAt.localeCompare(b.startsAt);
    })
    .slice(0, query.limit);
}
