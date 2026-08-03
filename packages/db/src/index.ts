import type {
  Category,
  CoverageRegion,
  CoverageRegionStatus,
  CoverageResponse,
  CoverageSource,
  EventListItem,
  GameRegistry,
  EventPage,
  EventQuery,
  EventSource,
  Game,
  NormalizedEvent,
  NormalizedVenue,
  UserPreferences,
} from "@town-map/contracts";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

let pool: Pool | undefined;

function positiveNumberEnv(name: string, fallback: number) {
  const configured = process.env[name];
  if (configured === undefined) return fallback;
  const value = Number(configured);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

export function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  pool ??= new Pool({
    connectionString,
    // One Railway PostgreSQL instance is shared by every API replica and all five
    // collectors, so the per-process ceiling has to be deployment-configurable.
    max: positiveNumberEnv("DATABASE_POOL_MAX", 10),
    // Return idle connections rather than holding the whole pool open forever.
    idleTimeoutMillis: positiveNumberEnv("DATABASE_IDLE_TIMEOUT_MS", 30_000),
    // Fail fast when the pool is exhausted instead of queueing without bound.
    connectionTimeoutMillis: positiveNumberEnv("DATABASE_CONNECTION_TIMEOUT_MS", 10_000),
    // Defaults to disabled: a statement ceiling that is right for a user-facing
    // request would abort long index builds and large collector batches. The API
    // sets this explicitly; migrations opt out regardless.
    statement_timeout: positiveNumberEnv("DATABASE_STATEMENT_TIMEOUT_MS", 0) || undefined,
    application_name: process.env.SERVICE_NAME ?? "town-map",
  });
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

/**
 * Session-scoped lock so two maintenance runs cannot delete concurrently.
 */
const RETENTION_LOCK_ID = 8042027;

/**
 * Deletes events that finished longer ago than the retention window.
 *
 * Nothing reads past events — the API only serves `starts_at >= now()` — but
 * they accumulate forever and sit in every index on the table, including the
 * geography indexes that answer each map query. Raw payloads and any future
 * child rows are removed by cascade.
 *
 * Deleted in bounded batches so a long-neglected database does not produce one
 * enormous transaction. Returns the number of events removed.
 */
export async function deleteExpiredEvents(
  retentionDays: number,
  options: { batchSize?: number; database?: Queryable } = {},
) {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error("retentionDays must be a positive integer");
  }
  const { batchSize = 5_000, database = getPool() } = options;
  const lock = await database.query(
    "SELECT pg_try_advisory_lock($1) AS acquired",
    [RETENTION_LOCK_ID],
  ) as { rows: Array<{ acquired: boolean }> };
  if (!lock.rows[0].acquired) return { deleted: 0, skipped: true };

  let deleted = 0;
  try {
    for (;;) {
      const result = await database.query(
        `DELETE FROM events
         WHERE id IN (
           SELECT id FROM events
           WHERE starts_at < now() - make_interval(days => $1)
           LIMIT $2
         )`,
        [retentionDays, batchSize],
      ) as { rowCount: number | null };
      const removed = result.rowCount ?? 0;
      deleted += removed;
      if (removed < batchSize) break;
    }
  } finally {
    await database.query("SELECT pg_advisory_unlock($1)", [RETENTION_LOCK_ID]);
  }
  return { deleted, skipped: false };
}

/**
 * Reads the game and category taxonomy.
 *
 * Ordered by `position` then label so display order is a data decision. Disabled
 * games are omitted: a game is disabled to retire it from the filters without
 * deleting the events already collected under it.
 */
export async function listGameRegistry(database: Queryable = getPool()): Promise<GameRegistry> {
  const [gameResult, categoryResult] = await Promise.all([
    database.query<{ id: Game; label: string; category: Category }>(
      `SELECT g.slug AS id, g.label, g.category_slug AS category
       FROM games g
       JOIN categories c ON c.slug = g.category_slug
       WHERE g.enabled = true
       ORDER BY c.position, c.slug, g.position, g.label`,
    ),
    database.query<{ id: Category; label: string }>(
      `SELECT slug AS id, label FROM categories ORDER BY position, slug`,
    ),
  ]);
  return { games: gameResult.rows, categories: categoryResult.rows };
}

/**
 * Recomputes the upcoming-event snapshot for one source.
 *
 * Runs after a collection run rather than on request, so the scan this replaces
 * never sits in front of a user. Served by events_source_starts_at_idx.
 */
export async function refreshSourceEventCount(source: EventSource, database: Queryable = getPool()) {
  await database.query(
    `INSERT INTO source_event_counts (source, upcoming_events, computed_at)
     SELECT $1, count(*), now() FROM events
     WHERE source = $1 AND starts_at >= now() AND withdrawn_at IS NULL
     ON CONFLICT (source) DO UPDATE SET
       upcoming_events = EXCLUDED.upcoming_events,
       computed_at = EXCLUDED.computed_at`,
    [source],
  );
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
    database.query<{ source: EventSource; upcomingEvents: number; computedAt: Date }>(
      `SELECT source, upcoming_events AS "upcomingEvents", computed_at AS "computedAt"
       FROM source_event_counts`,
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
  const eventCounts = new Map(eventCountResult.rows.map((row) => [row.source, row]));
  const sources = new Map<EventSource, CoverageSource>();

  for (const source of new Set([...regions.map((region) => region.source), ...eventCounts.keys()])) {
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
      upcomingEvents: Number(eventCounts.get(source)?.upcomingEvents ?? 0),
      upcomingEventsComputedAt: eventCounts.get(source)?.computedAt?.toISOString() ?? null,
      latestSuccessAt,
    });
  }

  return {
    generatedAt: generatedAt.toISOString(),
    sources: [...sources.values()].sort((left, right) => left.source.localeCompare(right.source)),
    regions,
  };
}

type UserPreferencesRow = {
  homeAddress: string;
  selectedGames: Game[];
  onboardingCompletedAt: Date | null;
};

function toUserPreferences(row: UserPreferencesRow | undefined): UserPreferences {
  return {
    homeAddress: row?.homeAddress ?? null,
    selectedGames: row?.selectedGames ?? [],
    onboardingCompleted: Boolean(row?.onboardingCompletedAt),
  };
}

export async function getUserPreferences(
  clerkUserId: string,
  database: Queryable = getPool(),
): Promise<UserPreferences> {
  const result = await database.query<UserPreferencesRow>(
    `SELECT home_address AS "homeAddress",
            selected_games AS "selectedGames",
            onboarding_completed_at AS "onboardingCompletedAt"
     FROM user_preferences
     WHERE clerk_user_id = $1`,
    [clerkUserId],
  );
  return toUserPreferences(result.rows[0]);
}

export async function saveUserPreferences(
  clerkUserId: string,
  homeAddress: string,
  selectedGames: Game[],
  database: Queryable = getPool(),
): Promise<UserPreferences> {
  const result = await database.query<UserPreferencesRow>(
    `INSERT INTO user_preferences (clerk_user_id, home_address, selected_games, onboarding_completed_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (clerk_user_id) DO UPDATE SET
       home_address = EXCLUDED.home_address,
       selected_games = EXCLUDED.selected_games,
       onboarding_completed_at = COALESCE(user_preferences.onboarding_completed_at, now()),
       home_label = NULL,
       home_latitude = NULL,
       home_longitude = NULL,
       updated_at = now()
     RETURNING home_address AS "homeAddress",
               selected_games AS "selectedGames",
               onboarding_completed_at AS "onboardingCompletedAt"`,
    [clerkUserId, homeAddress, selectedGames],
  );
  return toUserPreferences(result.rows[0]);
}

/**
 * Columns whose value defines an event record. A re-sync that leaves all of them
 * unchanged must not write, or every collection cycle would rewrite every row and
 * produce one dead tuple per event per run.
 */
const EVENT_MUTABLE_COLUMNS = [
  "game", "venue_id", "title", "description", "starts_at", "ends_at", "timezone",
  "status", "format", "event_type", "source_url", "registration_url", "price_amount",
  "price_currency", "capacity", "is_online", "latitude", "longitude",
  // Included so that seeing a withdrawn event again counts as a change and
  // therefore un-withdraws it. `collection_region_id` is deliberately absent:
  // where two regions overlap, comparing it would make every shared event look
  // changed on every run and reintroduce the write churn this guard removes.
  "withdrawn_at",
] as const;

const VENUE_MUTABLE_COLUMNS = [
  "name", "address", "city", "region", "postal_code", "country",
  "latitude", "longitude", "website", "phone",
] as const;

function assignExcluded(columns: readonly string[]) {
  return columns.map((column) => `${column} = EXCLUDED.${column}`).join(", ");
}

function changedPredicate(table: string, columns: readonly string[]) {
  return `(${columns.map((column) => `${table}.${column}`).join(", ")})
     IS DISTINCT FROM
     (${columns.map((column) => `EXCLUDED.${column}`).join(", ")})`;
}

/**
 * Upserts every distinct venue referenced by `events` in one statement and
 * returns a source-venue-id to primary-key map. Collectors routinely report
 * hundreds of events at the same handful of venues, so deduplicating first turns
 * one write per event into one write per venue.
 */
async function upsertVenues(client: PoolClient, source: EventSource, events: NormalizedEvent[]) {
  const venues = new Map<string, NormalizedVenue>();
  for (const event of events) if (event.venue) venues.set(event.venue.sourceVenueId, event.venue);
  if (!venues.size) return new Map<string, string>();

  const payload = [...venues.values()].map((venue) => ({
    source_venue_id: venue.sourceVenueId,
    name: venue.name,
    address: venue.address,
    city: venue.city,
    region: venue.region,
    postal_code: venue.postalCode,
    country: venue.country,
    latitude: venue.latitude,
    longitude: venue.longitude,
    website: venue.website,
    phone: venue.phone,
  }));

  await client.query(
    `INSERT INTO venues (
       source, source_venue_id, name, address, city, region, postal_code, country,
       latitude, longitude, website, phone
     )
     SELECT $1, entry.source_venue_id, entry.name, entry.address, entry.city, entry.region,
       entry.postal_code, entry.country, entry.latitude, entry.longitude, entry.website, entry.phone
     FROM jsonb_to_recordset($2::jsonb) AS entry(
       source_venue_id text, name text, address text, city text, region text,
       postal_code text, country text, latitude double precision,
       longitude double precision, website text, phone text
     )
     ON CONFLICT (source, source_venue_id) DO UPDATE SET
       ${assignExcluded(VENUE_MUTABLE_COLUMNS)}, updated_at = now()
     WHERE ${changedPredicate("venues", VENUE_MUTABLE_COLUMNS)}`,
    [source, JSON.stringify(payload)],
  );

  // Unchanged rows are skipped by the guard above and so are absent from
  // RETURNING; read the ids back separately to cover every referenced venue.
  const result = await client.query<{ id: string; sourceVenueId: string }>(
    `SELECT id, source_venue_id AS "sourceVenueId"
     FROM venues
     WHERE source = $1 AND source_venue_id = ANY($2::text[])`,
    [source, [...venues.keys()]],
  );
  return new Map(result.rows.map((row) => [row.sourceVenueId, row.id]));
}

async function upsertEventBatch(
  client: PoolClient,
  source: EventSource,
  batch: NormalizedEvent[],
  venueIds: Map<string, string>,
  collectionRegionId: string | null,
) {
  const payload = batch.map((event) => ({
    source_event_id: event.sourceEventId,
    game: event.game,
    venue_id: event.venue ? venueIds.get(event.venue.sourceVenueId) ?? null : null,
    title: event.title,
    description: event.description,
    starts_at: event.startsAt,
    ends_at: event.endsAt,
    timezone: event.timezone,
    status: event.status,
    format: event.format,
    event_type: event.eventType,
    source_url: event.sourceUrl,
    registration_url: event.registrationUrl,
    price_amount: event.priceAmount,
    price_currency: event.priceCurrency,
    capacity: event.capacity,
    is_online: event.isOnline,
    // Denormalised from the venue so one index can serve time, game and location.
    latitude: event.venue?.latitude ?? null,
    longitude: event.venue?.longitude ?? null,
    raw: event.raw ?? {},
  }));

  await client.query(
    `INSERT INTO events (
       source, source_event_id, game, venue_id, title, description, starts_at, ends_at,
       timezone, status, format, event_type, source_url, registration_url, price_amount,
       price_currency, capacity, is_online, latitude, longitude,
       collection_region_id, withdrawn_at
     )
     SELECT $1, entry.source_event_id, entry.game, entry.venue_id, entry.title, entry.description,
       entry.starts_at, entry.ends_at, entry.timezone, entry.status, entry.format, entry.event_type,
       entry.source_url, entry.registration_url, entry.price_amount, entry.price_currency,
       entry.capacity, entry.is_online, entry.latitude, entry.longitude,
       $3::uuid, NULL::timestamptz
     FROM jsonb_to_recordset($2::jsonb) AS entry(
       source_event_id text, game text, venue_id uuid, title text, description text,
       starts_at timestamptz, ends_at timestamptz, timezone text, status text, format text,
       event_type text, source_url text, registration_url text, price_amount numeric(10, 2),
       price_currency text, capacity integer, is_online boolean, latitude double precision,
       longitude double precision, raw jsonb
     )
     ON CONFLICT (source, source_event_id) DO UPDATE SET
       ${assignExcluded(EVENT_MUTABLE_COLUMNS)},
       -- Kept when a collector writes without a region, so a region-less run
       -- cannot orphan an event from the region responsible for withdrawing it.
       collection_region_id = COALESCE(EXCLUDED.collection_region_id, events.collection_region_id),
       last_seen_at = now(), updated_at = now()
     WHERE ${changedPredicate("events", EVENT_MUTABLE_COLUMNS)}`,
    [source, JSON.stringify(payload), collectionRegionId],
  );

  // Joined back on the natural key because the upsert above deliberately does
  // not return unchanged rows, so their ids are not available from it. Raw
  // payloads are compared too: an event whose upstream record is byte-identical
  // should cost no write here either.
  await client.query(
    `INSERT INTO event_raw (event_id, raw)
     SELECT e.id, COALESCE(entry.raw, '{}'::jsonb)
     FROM jsonb_to_recordset($2::jsonb) AS entry(source_event_id text, raw jsonb)
     JOIN events e ON e.source = $1 AND e.source_event_id = entry.source_event_id
     ON CONFLICT (event_id) DO UPDATE SET raw = EXCLUDED.raw, updated_at = now()
     WHERE event_raw.raw IS DISTINCT FROM EXCLUDED.raw`,
    [source, JSON.stringify(payload)],
  );
}

/**
 * Withdraws the upcoming events a region owns but did not return.
 *
 * Only ever called after a region completes successfully, so a failed upstream
 * fetch cannot empty a city. Scoped to one region and to future events: past
 * events legitimately drop out of upstream feeds, and an event another region
 * owns is that region's to withdraw.
 *
 * Known limitation: where two regions overlap, an event that leaves one
 * region's scope while remaining in another's is withdrawn by its owner and
 * stays hidden until the other region next writes it. Per-region sighting
 * records would close that gap and are worth adding alongside a metropolitan
 * search-centre catalogue.
 */
export async function withdrawMissingEvents(
  collectionRegionId: string,
  seenSourceEventIds: string[],
  database: Queryable = getPool(),
) {
  // An empty result is the shape a silently broken upstream takes, and acting on
  // it would withdraw an entire region at once. Refusing here means a region
  // that has genuinely emptied keeps stale events until it returns something,
  // which is the recoverable direction of the two.
  if (!seenSourceEventIds.length) return 0;
  const result = await database.query(
    `WITH seen AS (SELECT unnest($2::text[]) AS source_event_id)
     UPDATE events e
     SET withdrawn_at = now(), updated_at = now()
     WHERE e.collection_region_id = $1
       AND e.starts_at >= now()
       AND e.withdrawn_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM seen WHERE seen.source_event_id = e.source_event_id)`,
    [collectionRegionId, seenSourceEventIds],
  );
  return result.rowCount ?? 0;
}

/**
 * Persists a collector's output. Venues are written once per distinct venue and
 * events in bulk statements, and rows whose content is unchanged are left
 * untouched.
 *
 * Returns the number of events persisted, which is every event supplied — not
 * only those that changed. Because unchanged rows are skipped, `last_seen_at`
 * marks the last time an event's content changed rather than the last time a
 * collector observed it; detecting events withdrawn upstream needs a
 * region-scoped set comparison rather than this column.
 */
export async function upsertEvents(
  source: EventSource,
  events: NormalizedEvent[],
  options: { collectionRegionId?: string | null; batchSize?: number } = {},
) {
  if (!events.length) return 0;
  const { collectionRegionId = null, batchSize = 500 } = options;
  // `ON CONFLICT` cannot touch the same row twice in one statement, so collapse
  // duplicate ids first. Later entries win, matching the previous row-by-row order.
  const deduplicated = [...new Map(events.map((event) => [event.sourceEventId, event])).values()];
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const venueIds = await upsertVenues(client, source, deduplicated);
    for (let offset = 0; offset < deduplicated.length; offset += batchSize) {
      await upsertEventBatch(
        client,
        source,
        deduplicated.slice(offset, offset + batchSize),
        venueIds,
        collectionRegionId,
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return deduplicated.length;
}

export async function upsertEvent(source: EventSource, event: NormalizedEvent) {
  await upsertEvents(source, [event]);
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

function cursorScope(query: Omit<EventQuery, "categories">) {
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

const eventColumns = `
  e.id, e.source, e.source_event_id AS "sourceEventId", e.game, e.title,
  e.description, e.starts_at AS "startsAt", e.ends_at AS "endsAt",
  e.timezone, e.status, e.format, e.event_type AS "eventType",
  e.source_url AS "sourceUrl", e.registration_url AS "registrationUrl",
  e.price_amount AS "priceAmount",
  e.price_currency AS "priceCurrency", e.capacity, e.is_online AS "isOnline"`;

const venueColumns = `
  v.name AS "venueName", v.address AS "venueAddress", v.city AS "venueCity",
  v.region AS "venueRegion", v.postal_code AS "venuePostalCode",
  v.latitude AS "venueLatitude", v.longitude AS "venueLongitude",
  v.website AS "venueWebsite"`;

const eventSelect = `${eventColumns},${venueColumns}`;

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

/**
 * Categories are expanded to their games by the API, so they never reach the
 * query and the hot path stays free of a join against the taxonomy tables.
 */
export type EventLookup = Omit<EventQuery, "categories">;

export async function listEvents(query: EventLookup, database: Pick<Pool, "query"> = getPool()): Promise<EventPage> {
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
  // Withdrawn events are retained for audit but never served, and the partial
  // indexes backing this query carry the same predicate.
  const conditions = ["e.withdrawn_at IS NULL", `e.starts_at >= ${addValue(snapshotFrom)}`];
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
    // Coordinates are denormalised onto `events`, so the bounding box, the time
    // window and the game filter are all satisfiable from one index instead of a
    // nested loop that rescans the game slice once per candidate venue.
    conditions.push("e.latitude IS NOT NULL", "e.longitude IS NOT NULL");
    conditions.push(`e.latitude BETWEEN ${addValue(bounds.minLatitude)} AND ${addValue(bounds.maxLatitude)}`);
    if (!bounds.coversAllLongitudes) {
      const minimumLongitude = addValue(bounds.minLongitude);
      const maximumLongitude = addValue(bounds.maxLongitude);
      conditions.push(bounds.crossesAntimeridian
        ? `(e.longitude >= ${minimumLongitude} OR e.longitude <= ${maximumLongitude})`
        : `e.longitude BETWEEN ${minimumLongitude} AND ${maximumLongitude}`);
    }

    const distance = `2 * ${EARTH_RADIUS_METERS} * asin(sqrt(LEAST(1.0, GREATEST(0.0,
      power(sin(radians(e.latitude - ${latitude}) / 2), 2)
      + cos(radians(${latitude})) * cos(radians(e.latitude))
      * power(sin(radians(e.longitude - ${longitude}) / 2), 2)
    ))))`;

    const pageConditions = [`"distanceMeters" <= ${radiusMeters}`];
    if (cursor) {
      pageConditions.push(`("distanceMeters", "startsAt", id) > (${addValue(cursor.distanceMeters)}::double precision, ${addValue(cursor.startsAt)}::timestamptz, ${addValue(cursor.id)}::uuid)`);
    }
    const limit = addValue(query.limit + 1);
    // Rank on the narrow candidate set first, then read the wide event and venue
    // columns for the page only.
    sql = `WITH candidates AS (
      SELECT e.id, e.venue_id, e.starts_at AS "startsAt",
        ${distance} AS "distanceMeters"
      FROM events e
      WHERE ${conditions.join(" AND ")}
    ), page AS (
      SELECT * FROM candidates
      WHERE ${pageConditions.join(" AND ")}
      ORDER BY "distanceMeters" ASC, "startsAt" ASC, id ASC
      LIMIT ${limit}
    )
    SELECT ${eventSelect},
      page."distanceMeters"
    FROM page
    JOIN events e ON e.id = page.id
    LEFT JOIN venues v ON v.id = page.venue_id
    ORDER BY page."distanceMeters" ASC, page."startsAt" ASC, page.id ASC`;
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
