import type {
  CoverageRegion,
  CoverageRegionStatus,
  CoverageResponse,
  CoverageSource,
  EventListItem,
  EventPage,
  EventQuery,
  EventSource,
  NormalizedEvent,
} from "@town-map/contracts";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

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

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
};

export type CollectionRegionDefinition = {
  key: string;
  label: string;
  countryCode?: string | null;
  config: Record<string, unknown>;
  enabled?: boolean;
  priority?: number;
  cadenceMinutes?: number;
};

export type ClaimedCollectionRegion = {
  id: string;
  source: EventSource;
  key: string;
  label: string;
  countryCode: string | null;
  config: Record<string, unknown>;
  cadenceMinutes: number;
};

type CollectionRegionRow = {
  id: string;
  source: EventSource;
  regionKey: string;
  label: string;
  countryCode: string | null;
  config: Record<string, unknown>;
  cadenceMinutes: number;
};

export async function registerCollectionRegions(
  source: EventSource,
  regions: CollectionRegionDefinition[],
  database: Queryable = getPool(),
) {
  if (!regions.length) return;
  await database.query(
    `INSERT INTO collection_regions (
       source, region_key, label, country_code, config, enabled, priority, cadence_minutes
     )
     SELECT $1, definition.region_key, definition.label, definition.country_code,
       definition.config, definition.enabled, definition.priority, definition.cadence_minutes
     FROM jsonb_to_recordset($2::jsonb) AS definition(
       region_key text, label text, country_code text, config jsonb,
       enabled boolean, priority integer, cadence_minutes integer
     )
     ON CONFLICT (source, region_key) DO UPDATE SET
       label = EXCLUDED.label,
       country_code = EXCLUDED.country_code,
       config = EXCLUDED.config,
       enabled = EXCLUDED.enabled,
       priority = EXCLUDED.priority,
       cadence_minutes = EXCLUDED.cadence_minutes,
       updated_at = now()`,
    [source, JSON.stringify(regions.map((region) => ({
      region_key: region.key,
      label: region.label,
      country_code: region.countryCode ?? null,
      config: region.config,
      enabled: region.enabled ?? true,
      priority: region.priority ?? 100,
      cadence_minutes: region.cadenceMinutes ?? 360,
    })))],
  );
  await database.query(
    `UPDATE collection_regions
     SET enabled = false, updated_at = now()
     WHERE source = $1
       AND NOT (region_key = ANY($2::text[]))`,
    [source, regions.map((region) => region.key)],
  );
}

export async function claimNextCollectionRegion(
  source: EventSource,
  leaseOwner: string,
  leaseMinutes: number,
  database: Queryable = getPool(),
): Promise<ClaimedCollectionRegion | null> {
  const result = await database.query<CollectionRegionRow>(
    `WITH candidate AS (
       SELECT id
       FROM collection_regions
       WHERE source = $1
         AND enabled = true
         AND next_run_at <= now()
         AND (lease_expires_at IS NULL OR lease_expires_at <= now())
       ORDER BY priority ASC, next_run_at ASC, region_key ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE collection_regions AS region
     SET lease_owner = $2,
       lease_expires_at = now() + make_interval(mins => $3),
       last_started_at = now(),
       updated_at = now()
     FROM candidate
     WHERE region.id = candidate.id
     RETURNING region.id, region.source, region.region_key AS "regionKey",
       region.label, region.country_code AS "countryCode", region.config,
       region.cadence_minutes AS "cadenceMinutes"`,
    [source, leaseOwner, leaseMinutes],
  );
  const region = result.rows[0];
  return region ? {
    id: region.id,
    source: region.source,
    key: region.regionKey,
    label: region.label,
    countryCode: region.countryCode,
    config: region.config,
    cadenceMinutes: region.cadenceMinutes,
  } : null;
}

export async function finishCollectionRegion(
  id: string,
  leaseOwner: string,
  outcome: { status: "succeeded" | "failed"; error?: string; retryMinutes?: number },
  database: Queryable = getPool(),
) {
  const result = await database.query(
    `UPDATE collection_regions
     SET lease_owner = NULL,
       lease_expires_at = NULL,
       next_run_at = now() + make_interval(mins => CASE WHEN $3 = 'succeeded' THEN cadence_minutes ELSE $5 END),
       last_success_at = CASE WHEN $3 = 'succeeded' THEN now() ELSE last_success_at END,
       last_failure_at = CASE WHEN $3 = 'failed' THEN now() ELSE last_failure_at END,
       last_error = CASE WHEN $3 = 'failed' THEN $4 ELSE NULL END,
       updated_at = now()
     WHERE id = $1 AND lease_owner = $2`,
    [id, leaseOwner, outcome.status, outcome.error ?? null, outcome.retryMinutes ?? 30],
  );
  if (result.rowCount !== 1) throw new Error(`Collection region ${id} is no longer leased by this worker`);
}

export async function beginSync(
  source: EventSource,
  region?: Pick<ClaimedCollectionRegion, "id" | "key">,
  database: Queryable = getPool(),
): Promise<string> {
  const result = await database.query<{ id: string }>(
    `INSERT INTO sync_runs (source, collection_region_id, region_key)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [source, region?.id ?? null, region?.key ?? null],
  );
  return result.rows[0].id;
}

export async function finishSync(
  id: string,
  values: { status: "succeeded" | "failed"; eventsSeen: number; eventsWritten: number; error?: string },
  database: Queryable = getPool(),
) {
  await database.query(
    `UPDATE sync_runs
     SET status = $2, events_seen = $3, events_written = $4, error_message = $5, finished_at = now()
     WHERE id = $1`,
    [id, values.status, values.eventsSeen, values.eventsWritten, values.error ?? null],
  );
}

type CoverageRegionRow = {
  source: EventSource;
  regionKey: string;
  label: string;
  countryCode: string | null;
  enabled: boolean;
  cadenceMinutes: number;
  nextRunAt: Date;
  leaseExpiresAt: Date | null;
  lastStartedAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
};

function coverageStatus(region: CoverageRegionRow, now: Date): CoverageRegionStatus {
  if (!region.enabled) return "disabled";
  if (region.leaseExpiresAt && region.leaseExpiresAt > now) return "running";
  if (region.lastFailureAt && (!region.lastSuccessAt || region.lastFailureAt > region.lastSuccessAt)) return "failing";
  if (!region.lastSuccessAt) return "pending";
  const staleAt = region.lastSuccessAt.getTime() + region.cadenceMinutes * 2 * 60_000;
  return staleAt < now.getTime() ? "stale" : "fresh";
}

export async function listCoverage(database: Queryable = getPool()): Promise<CoverageResponse> {
  const generatedAt = new Date();
  const [regionResult, eventCountResult] = await Promise.all([
    database.query<CoverageRegionRow>(
      `SELECT source, region_key AS "regionKey", label, country_code AS "countryCode",
         enabled, cadence_minutes AS "cadenceMinutes", next_run_at AS "nextRunAt",
         lease_expires_at AS "leaseExpiresAt", last_started_at AS "lastStartedAt",
         last_success_at AS "lastSuccessAt", last_failure_at AS "lastFailureAt"
       FROM collection_regions
       ORDER BY source, country_code NULLS LAST, label, region_key`,
    ),
    database.query<{ source: EventSource; upcomingEvents: string }>(
      `SELECT source, count(*)::text AS "upcomingEvents"
       FROM events
       WHERE starts_at >= now()
       GROUP BY source`,
    ),
  ]);
  const regions: CoverageRegion[] = regionResult.rows.map((region) => ({
    source: region.source,
    key: region.regionKey,
    label: region.label,
    countryCode: region.countryCode,
    enabled: region.enabled,
    status: coverageStatus(region, generatedAt),
    due: region.enabled && region.nextRunAt <= generatedAt
      && (!region.leaseExpiresAt || region.leaseExpiresAt <= generatedAt),
    cadenceMinutes: region.cadenceMinutes,
    nextRunAt: region.nextRunAt.toISOString(),
    lastStartedAt: region.lastStartedAt?.toISOString() ?? null,
    lastSuccessAt: region.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: region.lastFailureAt?.toISOString() ?? null,
  }));
  const upcomingEvents = new Map(eventCountResult.rows.map((row) => [row.source, Number(row.upcomingEvents)]));
  const sources = new Map<EventSource, CoverageSource>();

  for (const source of new Set([...regions.map((region) => region.source), ...upcomingEvents.keys()])) {
    const sourceRegions = regions.filter((region) => region.source === source);
    const latestSuccessAt = sourceRegions
      .map((region) => region.lastSuccessAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
    sources.set(source, {
      source,
      totalRegions: sourceRegions.length,
      enabledRegions: sourceRegions.filter((region) => region.enabled).length,
      freshRegions: sourceRegions.filter((region) => region.status === "fresh").length,
      pendingRegions: sourceRegions.filter((region) => region.status === "pending").length,
      staleRegions: sourceRegions.filter((region) => region.status === "stale").length,
      failingRegions: sourceRegions.filter((region) => region.status === "failing").length,
      runningRegions: sourceRegions.filter((region) => region.status === "running").length,
      upcomingEvents: upcomingEvents.get(source) ?? 0,
      latestSuccessAt,
    });
  }

  return {
    generatedAt: generatedAt.toISOString(),
    sources: [...sources.values()].sort((left, right) => left.source.localeCompare(right.source)),
    regions,
  };
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

async function upsertEventWithClient(client: PoolClient, source: EventSource, event: NormalizedEvent) {
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
}

export async function upsertEvents(source: EventSource, events: NormalizedEvent[], batchSize = 250) {
  if (!events.length) return 0;
  const client = await getPool().connect();
  let written = 0;
  try {
    for (let offset = 0; offset < events.length; offset += batchSize) {
      const batch = events.slice(offset, offset + batchSize);
      try {
        await client.query("BEGIN");
        for (const event of batch) await upsertEventWithClient(client, source, event);
        await client.query("COMMIT");
        written += batch.length;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
  }
  return written;
}

export async function upsertEvent(source: EventSource, event: NormalizedEvent) {
  await upsertEvents(source, [event], 1);
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
const EARTH_RADIUS_METERS = 6_371_008.8;

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

function normalizeLongitude(longitude: number) {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

function searchBounds(latitude: number, longitude: number, radiusMeters: number) {
  const angularDistance = radiusMeters / EARTH_RADIUS_METERS;
  const latitudeRadians = (latitude * Math.PI) / 180;
  const latitudeDelta = (angularDistance * 180) / Math.PI;
  const longitudeRatio = Math.sin(angularDistance) / Math.max(Math.cos(latitudeRadians), Number.EPSILON);
  const longitudeDelta = longitudeRatio >= 1 ? 180 : (Math.asin(longitudeRatio) * 180) / Math.PI;
  return {
    minLatitude: Math.max(-90, latitude - latitudeDelta),
    maxLatitude: Math.min(90, latitude + latitudeDelta),
    minLongitude: normalizeLongitude(longitude - longitudeDelta),
    maxLongitude: normalizeLongitude(longitude + longitudeDelta),
    crossesAntimeridian: longitudeDelta < 180
      && normalizeLongitude(longitude - longitudeDelta) > normalizeLongitude(longitude + longitudeDelta),
    coversAllLongitudes: longitudeDelta >= 180,
  };
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
    const bounds = searchBounds(query.latitude!, query.longitude!, query.radiusMiles * METERS_PER_MILE);
    conditions.push("v.latitude IS NOT NULL", "v.longitude IS NOT NULL");
    conditions.push(`v.latitude BETWEEN ${addValue(bounds.minLatitude)} AND ${addValue(bounds.maxLatitude)}`);
    if (!bounds.coversAllLongitudes) {
      const minimumLongitude = addValue(bounds.minLongitude);
      const maximumLongitude = addValue(bounds.maxLongitude);
      conditions.push(bounds.crossesAntimeridian
        ? `(v.longitude >= ${minimumLongitude} OR v.longitude <= ${maximumLongitude})`
        : `v.longitude BETWEEN ${minimumLongitude} AND ${maximumLongitude}`);
    }

    const distance = `2 * ${EARTH_RADIUS_METERS} * asin(sqrt(LEAST(1.0, GREATEST(0.0,
      power(sin(radians(v.latitude - ${latitude}) / 2), 2)
      + cos(radians(${latitude})) * cos(radians(v.latitude))
      * power(sin(radians(v.longitude - ${longitude}) / 2), 2)
    ))))`;

    const pageConditions = [`"distanceMeters" <= ${radiusMeters}`];
    if (cursor) {
      pageConditions.push(`("distanceMeters", "startsAt", id) > (${addValue(cursor.distanceMeters)}::double precision, ${addValue(cursor.startsAt)}::timestamptz, ${addValue(cursor.id)}::uuid)`);
    }
    const limit = addValue(query.limit + 1);
    sql = `WITH candidates AS (
      SELECT ${eventSelect},
        ${distance} AS "distanceMeters"
      FROM events e
      JOIN venues v ON v.id = e.venue_id
      WHERE ${conditions.join(" AND ")}
    )
    SELECT * FROM candidates
    WHERE ${pageConditions.join(" AND ")}
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
