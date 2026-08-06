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
  SavedEvents,
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
 * Local weekday and minute-of-day for an occurrence, in the venue's own time.
 *
 * A UTC weekday and time shift by an hour across daylight saving, which would
 * split a weekly series in two every spring and autumn. `timezone` is retained
 * per event for exactly this; UTC is only the fallback when a source gives none.
 */
const LOCAL_SCHEDULE_SQL = `
  (e.starts_at AT TIME ZONE COALESCE(e.timezone, 'UTC'))`;

/**
 * The deterministic key grouping occurrences into a series.
 *
 * An upstream series identifier wins where the source publishes one. Otherwise
 * the key is derived from what actually characterises a recurring event: the
 * venue, the game, the format, and the local weekday and start time. Title is
 * excluded on purpose — "FNM", "Friday Night Magic" and "FNM #42" are one
 * series, and including the title would fork it three ways.
 */
const SERIES_KEY_SQL = `
  CASE
    WHEN e.source_series_id IS NOT NULL THEN 'upstream:' || e.source_series_id
    WHEN e.venue_id IS NULL THEN NULL
    ELSE 'derived:' || e.venue_id::text
      || ':' || e.game
      || ':' || COALESCE(lower(btrim(e.format)), '')
      || ':' || EXTRACT(dow FROM ${LOCAL_SCHEDULE_SQL})::int::text
      || ':' || (
           EXTRACT(hour FROM ${LOCAL_SCHEDULE_SQL})::int * 60
           + EXTRACT(minute FROM ${LOCAL_SCHEDULE_SQL})::int
         )::text
  END`;

/**
 * How far a start time may move before it is treated as a different series.
 *
 * Wide enough to absorb a store shifting an evening tournament by half an hour,
 * narrow enough that an afternoon and an evening event on the same night stay
 * separate.
 */
const SERIES_DRIFT_MINUTES = 60;

/**
 * Session-scoped lock so two maintenance runs cannot delete concurrently.
 */
const RETENTION_LOCK_ID = 8042027;

/**
 * Snapshot column on `saved_events` paired with the expression that fills it.
 *
 * Written once because two paths populate these columns -- saving an event and
 * retention refreshing it just before deletion -- and a column filled by one but
 * not the other would freeze a partly-empty record that nothing later can repair.
 */
const SAVED_EVENT_SNAPSHOT: ReadonlyArray<readonly [string, string]> = [
  ["source", "e.source"],
  ["source_event_id", "e.source_event_id"],
  ["game", "e.game"],
  ["title", "e.title"],
  ["description", "e.description"],
  ["starts_at", "e.starts_at"],
  ["ends_at", "e.ends_at"],
  ["timezone", "e.timezone"],
  ["status", "e.status"],
  ["format", "e.format"],
  ["event_type", "e.event_type"],
  ["source_url", "e.source_url"],
  ["registration_url", "e.registration_url"],
  ["price_amount", "e.price_amount"],
  ["price_currency", "e.price_currency"],
  ["capacity", "e.capacity"],
  ["is_online", "e.is_online"],
  ["withdrawn_at", "e.withdrawn_at"],
  ["venue_name", "v.name"],
  ["venue_address", "v.address"],
  ["venue_city", "v.city"],
  ["venue_region", "v.region"],
  ["venue_postal_code", "v.postal_code"],
  ["venue_latitude", "v.latitude"],
  ["venue_longitude", "v.longitude"],
  ["venue_website", "v.website"],
];

const snapshotColumns = SAVED_EVENT_SNAPSHOT.map(([column]) => column).join(", ");
// Aliased, because a bare `v.name` comes out of a subquery called `name` and the
// insert that reads it back is looking for `venue_name`.
const snapshotProjection = SAVED_EVENT_SNAPSHOT
  .map(([column, expression]) => `${expression} AS ${column}`)
  .join(", ");
const snapshotAssignments = SAVED_EVENT_SNAPSHOT
  .map(([column, expression]) => `${column} = ${expression}`)
  .join(", ");
const snapshotExcluded = SAVED_EVENT_SNAPSHOT
  .map(([column]) => `${column} = EXCLUDED.${column}`)
  .join(", ");

/**
 * Deletes events that finished longer ago than the retention window.
 *
 * Nothing reads past events from `events` -- the API only serves
 * `starts_at >= now()` -- but they accumulate forever and sit in every index on
 * the table, including the geography indexes that answer each map query. Raw
 * payloads and any future child rows are removed by cascade.
 *
 * Saves are the exception: their foreign key is `ON DELETE SET NULL`, so a save
 * outlives the event and falls back to the snapshot it carries. That snapshot is
 * refreshed here, immediately before the delete, so what freezes is the event as
 * it last stood rather than as it looked on the day someone saved it -- a year
 * is long enough for a venue or a start time to have moved since.
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
    // One statement for the whole expiring set rather than per batch: it touches
    // only rows someone saved, which is a vanishing fraction of what expires,
    // and doing it up front keeps the delete loop a plain delete loop.
    await database.query(
      `UPDATE saved_events se
       SET ${snapshotAssignments}
       FROM events e
       LEFT JOIN venues v ON v.id = e.venue_id
       WHERE se.event_id = e.id
         AND e.starts_at < now() - make_interval(days => $1)`,
      [retentionDays],
    );

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
 * Groups a source's occurrences into recurring series.
 *
 * Runs after ingest rather than inside it, so the change-aware upsert on the
 * hot path is untouched and a mistake here can be corrected by recomputing
 * rather than by re-collecting.
 *
 * Three steps, each idempotent:
 *  1. every unassigned occurrence gets its deterministic key;
 *  2. a key with no series either joins one whose schedule it matches — this is
 *     what stops a store moving its start time from forking the series and
 *     orphaning subscribers — or starts a new one;
 *  3. each affected series has its description and statistics refreshed.
 */
export async function assignEventSeries(source: EventSource, database?: Queryable) {
  // The pass stages rows in a temporary table, which lives on one session and
  // for one transaction. A pool would hand each statement a different
  // connection, so when no session is supplied one is checked out explicitly.
  if (database) {
    const assigned = await assignEventSeriesWithin(source, database);
    await refreshEventSeriesStatistics(source, database);
    return assigned;
  }
  const client = await getPool().connect();
  try {
    const assigned = await assignEventSeriesWithin(source, client);
    await refreshEventSeriesStatistics(source, client);
    return assigned;
  } finally {
    client.release();
  }
}

async function assignEventSeriesWithin(source: EventSource, database: Queryable) {
  await database.query("BEGIN");
  try {
    const assigned = await stageAndAssign(source, database);
    await database.query("COMMIT");
    return assigned;
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  }
}

async function stageAndAssign(source: EventSource, database: Queryable) {
  // 1. Key the occurrences that do not have a series yet. Withdrawn events are
  // skipped: a cancelled week says nothing about the schedule.
  await database.query(
    `CREATE TEMP TABLE pending_series_keys ON COMMIT DROP AS
     SELECT e.id AS event_id,
       ${SERIES_KEY_SQL} AS key,
       e.game, e.venue_id, e.title, e.format,
       COALESCE(e.timezone, 'UTC') AS timezone,
       EXTRACT(dow FROM ${LOCAL_SCHEDULE_SQL})::int AS weekday,
       (EXTRACT(hour FROM ${LOCAL_SCHEDULE_SQL})::int * 60
        + EXTRACT(minute FROM ${LOCAL_SCHEDULE_SQL})::int) AS local_start_minute,
       e.starts_at
     FROM events e
     WHERE e.source = $1
       AND e.series_id IS NULL
       AND e.withdrawn_at IS NULL
       AND ${SERIES_KEY_SQL} IS NOT NULL`,
    [source],
  );

  // 2a. Attach a new key to an existing series on the same local schedule.
  // Requires exactly one candidate: a venue running two events an hour apart on
  // the same night is two series, and merging them would be worse than forking.
  await database.query(
    `WITH unmatched AS (
       SELECT DISTINCT key, game, venue_id, weekday, local_start_minute
       FROM pending_series_keys p
       WHERE NOT EXISTS (SELECT 1 FROM event_series_keys k WHERE k.source = $1 AND k.key = p.key)
     ), candidate AS (
       -- Only rows with exactly one match are used below, so which element the
       -- aggregate picks is immaterial; uuid has no min().
       SELECT u.key, (array_agg(s.id))[1] AS series_id, count(*) AS matches
       FROM unmatched u
       JOIN event_series s
         ON s.source = $1 AND s.game = u.game AND s.venue_id = u.venue_id
        AND s.weekday = u.weekday
        AND abs(s.local_start_minute - u.local_start_minute) <= $2
       GROUP BY u.key
     )
     INSERT INTO event_series_keys (source, key, series_id)
     SELECT $1, key, series_id FROM candidate WHERE matches = 1
     ON CONFLICT (source, key) DO NOTHING`,
    [source, SERIES_DRIFT_MINUTES],
  );

  // 2b. Anything still unmatched starts a new series. The identifiers are
  // generated up front rather than joined back from RETURNING: a key is
  // distinguished by its format too, so venue and schedule alone would not
  // match rows back unambiguously.
  await database.query(
    `CREATE TEMP TABLE new_event_series ON COMMIT DROP AS
     SELECT DISTINCT ON (p.key)
       p.key, gen_random_uuid() AS series_id, p.game, p.venue_id,
       p.title, p.format, p.timezone, p.weekday, p.local_start_minute
     FROM pending_series_keys p
     WHERE NOT EXISTS (SELECT 1 FROM event_series_keys k WHERE k.source = $1 AND k.key = p.key)
     -- Newest occurrence wins, so a series is described by its current title.
     ORDER BY p.key, p.starts_at DESC`,
    [source],
  );
  await database.query(
    `INSERT INTO event_series (
       id, source, game, venue_id, title, format, timezone, weekday, local_start_minute
     )
     SELECT series_id, $1, game, venue_id, title, format, timezone, weekday, local_start_minute
     FROM new_event_series`,
    [source],
  );
  await database.query(
    `INSERT INTO event_series_keys (source, key, series_id)
     SELECT $1, key, series_id FROM new_event_series
     ON CONFLICT (source, key) DO NOTHING`,
    [source],
  );

  // 3. Point the occurrences at their series.
  const assigned = await database.query(
    `UPDATE events e
     SET series_id = k.series_id, updated_at = now()
     FROM pending_series_keys p
     JOIN event_series_keys k ON k.source = $1 AND k.key = p.key
     WHERE e.id = p.event_id AND e.series_id IS DISTINCT FROM k.series_id`,
    [source],
  );

  return { assigned: assigned.rowCount ?? 0 };
}

/**
 * Recomputes each series' description and observed schedule from its
 * occurrences.
 *
 * Cadence is only asserted once three occurrences have been seen at a
 * consistent interval. Two events a week apart are a coincidence as easily as a
 * pattern, and claiming "repeats weekly" from one gap would be a guess dressed
 * up as a fact.
 */
export async function refreshEventSeriesStatistics(
  source: EventSource,
  database: Queryable = getPool(),
) {
  await database.query(
    `WITH occurrence AS (
       SELECT e.series_id, e.starts_at, e.title, e.format,
         EXTRACT(day FROM e.starts_at - lag(e.starts_at) OVER (
           PARTITION BY e.series_id ORDER BY e.starts_at))::int AS gap_days
       FROM events e
       WHERE e.source = $1 AND e.series_id IS NOT NULL AND e.withdrawn_at IS NULL
     ), stats AS (
       SELECT series_id,
         count(*) AS occurrence_count,
         min(starts_at) AS first_starts_at,
         max(starts_at) AS last_starts_at,
         min(starts_at) FILTER (WHERE starts_at >= now()) AS next_starts_at,
         mode() WITHIN GROUP (ORDER BY gap_days) FILTER (WHERE gap_days > 0) AS modal_gap_days,
         count(*) FILTER (WHERE gap_days > 0) AS gap_count
       FROM occurrence GROUP BY series_id
     ), latest AS (
       SELECT DISTINCT ON (series_id) series_id, title, format
       FROM occurrence ORDER BY series_id, starts_at DESC
     )
     UPDATE event_series s
     SET occurrence_count = stats.occurrence_count,
       first_starts_at = stats.first_starts_at,
       last_starts_at = stats.last_starts_at,
       next_starts_at = stats.next_starts_at,
       title = latest.title,
       format = latest.format,
       -- Needs at least two observed gaps, so three occurrences.
       cadence_days = CASE WHEN stats.gap_count >= 2 THEN stats.modal_gap_days END,
       updated_at = now()
     FROM stats JOIN latest ON latest.series_id = stats.series_id
     WHERE s.id = stats.series_id`,
    [source],
  );
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
  "price_currency", "capacity", "is_online", "latitude", "longitude", "search_text",
  "source_series_id",
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

/**
 * The text a free-text query is matched against, denormalised onto the event for
 * the same reason its coordinates are: keeping it on `events` lets one index
 * serve the search predicate instead of joining `venues` across every candidate.
 *
 * `game` is a slug, so its hyphens are split — otherwise "flesh-and-blood" is
 * one token and typing the words finds nothing. `description` is deliberately
 * left out: source descriptions are long, boilerplate-heavy and would drown a
 * title match in noise.
 */
function eventSearchText(event: NormalizedEvent) {
  return [
    event.title,
    event.game.replace(/-/g, " "),
    event.format,
    event.eventType,
    event.venue?.name,
    event.venue?.address,
    event.venue?.city,
    event.venue?.region,
  ].filter(Boolean).join(" ");
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
    source_series_id: event.sourceSeriesId ?? null,
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
    search_text: eventSearchText(event),
    raw: event.raw ?? {},
  }));

  await client.query(
    `INSERT INTO events (
       source, source_event_id, game, venue_id, title, description, starts_at, ends_at,
       timezone, status, format, event_type, source_url, registration_url, price_amount,
       price_currency, capacity, is_online, latitude, longitude, search_text, source_series_id,
       collection_region_id, withdrawn_at
     )
     SELECT $1, entry.source_event_id, entry.game, entry.venue_id, entry.title, entry.description,
       entry.starts_at, entry.ends_at, entry.timezone, entry.status, entry.format, entry.event_type,
       entry.source_url, entry.registration_url, entry.price_amount, entry.price_currency,
       entry.capacity, entry.is_online, entry.latitude, entry.longitude, entry.search_text,
       entry.source_series_id, $3::uuid, NULL::timestamptz
     FROM jsonb_to_recordset($2::jsonb) AS entry(
       source_event_id text, game text, venue_id uuid, title text, description text,
       starts_at timestamptz, ends_at timestamptz, timezone text, status text, format text,
       event_type text, source_url text, registration_url text, price_amount numeric(10, 2),
       price_currency text, capacity integer, is_online boolean, latitude double precision,
       longitude double precision, search_text text, source_series_id text, raw jsonb
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
  cursorStartsAt: string;
  seriesId: string | null;
  seriesCadenceDays: number | null;
  seriesOccurrenceCount: number | null;
  seriesNextStartsAt: Date | null;
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
    q: query.q ?? null,
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

/**
 * `starts_at` rendered with microsecond precision.
 *
 * The keyset cursor has to reproduce the sort key exactly. The driver returns
 * timestamptz as a JS Date, which only holds milliseconds, so a cursor built
 * from it lands just before the real value and the boundary rows repeat on the
 * next page.
 */
const CURSOR_STARTS_AT =
  `to_char(e.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorStartsAt"`;

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

/**
 * Joined only after the page limit has been applied, so this is a primary-key
 * lookup for at most `limit` rows rather than work across the candidate set.
 */
const seriesColumns = `
  s.id AS "seriesId", s.cadence_days AS "seriesCadenceDays",
  s.occurrence_count AS "seriesOccurrenceCount",
  s.next_starts_at AS "seriesNextStartsAt"`;

const eventSelect = `${eventColumns},${venueColumns},${seriesColumns}`;

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
    series: row.seriesId ? {
      id: row.seriesId,
      cadenceDays: row.seriesCadenceDays,
      occurrenceCount: row.seriesOccurrenceCount ?? 0,
      nextStartsAt: row.seriesNextStartsAt?.toISOString() ?? null,
    } : null,
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
 * Must stay equivalent to the expression indexed by `events_search_text_idx` in
 * migration 020 — the table alias is immaterial, but the text search
 * configuration and the coalesce fallback are not. PostgreSQL matches an
 * expression index by the expression, so a difference in either silently costs
 * the index and turns free-text search into a scan of every candidate event.
 */
const EVENT_SEARCH_VECTOR = "to_tsvector('english', coalesce(e.search_text, ''))";

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
  if (query.q) {
    // A query of nothing but stop words ("the", "a") parses to an empty tsquery,
    // which matches no row. Showing everything is the better reading of a search
    // that carries no searchable term, so the empty case falls through.
    const tsquery = `websearch_to_tsquery('english', ${addValue(query.q)})`;
    conditions.push(`(numnode(${tsquery}) = 0 OR ${EVENT_SEARCH_VECTOR} @@ ${tsquery})`);
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
        ${CURSOR_STARTS_AT},
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
      page."cursorStartsAt", page."distanceMeters"
    FROM page
    JOIN events e ON e.id = page.id
    LEFT JOIN venues v ON v.id = page.venue_id
    LEFT JOIN event_series s ON s.id = e.series_id
    ORDER BY page."distanceMeters" ASC, page."startsAt" ASC, page.id ASC`;
  } else {
    if (cursor) {
      conditions.push(`(e.starts_at, e.id) > (${addValue(cursor.startsAt)}::timestamptz, ${addValue(cursor.id)}::uuid)`);
    }
    const limit = addValue(query.limit + 1);
    sql = `SELECT ${eventSelect}, ${CURSOR_STARTS_AT}, NULL::double precision AS "distanceMeters"
      FROM events e
      LEFT JOIN venues v ON v.id = e.venue_id
      LEFT JOIN event_series s ON s.id = e.series_id
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
      startsAt: lastRow.cursorStartsAt,
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

/**
 * One user's saved events -- upcoming soonest first, past most recent first.
 *
 * Two branches rather than one join with `COALESCE` per column. Where the event
 * row survives it is authoritative for every field, including the ones it has
 * since set back to null; coalescing column by column would let a description
 * the organiser deleted resurface from the snapshot beside fields that had moved
 * on. Preferring one whole row over the other keeps a list item internally
 * consistent -- it is either the event as it stands or the event as it last
 * stood, never a blend of the two.
 *
 * Withdrawn events stay excluded in both branches. `saved_events.withdrawn_at`
 * exists for exactly this: without it a cancelled event would drop out of the
 * list for a year and then reappear as somewhere the user had been.
 *
 * Series are null on archived rows. A series summary describes how often
 * something recurs, which a frozen record of one past occurrence cannot answer
 * and should not guess at.
 *
 * `distanceMiles` is null throughout. A save has no search origin attached, and
 * inventing one from the account's home would make the same row read differently
 * here than it does in Discover.
 */
export async function listSavedEvents(
  clerkUserId: string,
  database: Queryable = getPool(),
): Promise<SavedEvents> {
  const result = await database.query<EventRow>(
    `WITH live AS (
       SELECT ${eventSelect}, e.starts_at AS "orderStartsAt"
       FROM saved_events se
       JOIN events e ON e.id = se.event_id
       LEFT JOIN venues v ON v.id = e.venue_id
       LEFT JOIN event_series s ON s.id = e.series_id
       WHERE se.clerk_user_id = $1
         AND e.withdrawn_at IS NULL
     ), archived AS (
       SELECT
         se.id, se.source, se.source_event_id AS "sourceEventId", se.game, se.title,
         se.description, se.starts_at AS "startsAt", se.ends_at AS "endsAt",
         se.timezone, se.status, se.format, se.event_type AS "eventType",
         se.source_url AS "sourceUrl", se.registration_url AS "registrationUrl",
         se.price_amount AS "priceAmount",
         se.price_currency AS "priceCurrency", se.capacity, se.is_online AS "isOnline",
         se.venue_name AS "venueName", se.venue_address AS "venueAddress",
         se.venue_city AS "venueCity", se.venue_region AS "venueRegion",
         se.venue_postal_code AS "venuePostalCode",
         se.venue_latitude AS "venueLatitude", se.venue_longitude AS "venueLongitude",
         se.venue_website AS "venueWebsite",
         NULL::uuid AS "seriesId", NULL::integer AS "seriesCadenceDays",
         NULL::integer AS "seriesOccurrenceCount", NULL::timestamptz AS "seriesNextStartsAt",
         se.starts_at AS "orderStartsAt"
       FROM saved_events se
       WHERE se.clerk_user_id = $1
         AND se.event_id IS NULL
         AND se.withdrawn_at IS NULL
     ), saved AS (
       SELECT * FROM live
       UNION ALL
       SELECT * FROM archived
     )
     SELECT *,
       to_char("orderStartsAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorStartsAt",
       NULL::double precision AS "distanceMeters"
     FROM saved
     ORDER BY
       ("orderStartsAt" >= now()) DESC,
       CASE WHEN "orderStartsAt" >= now() THEN "orderStartsAt" END ASC,
       CASE WHEN "orderStartsAt" < now() THEN "orderStartsAt" END DESC,
       id ASC`,
    [clerkUserId],
  );

  const now = Date.now();
  const events = result.rows.map(toEventListItem);
  const firstPast = events.findIndex((event) => Date.parse(event.startsAt) < now);
  const boundary = firstPast === -1 ? events.length : firstPast;
  return {
    upcoming: events.slice(0, boundary),
    past: events.slice(boundary),
    count: events.length,
  };
}

/**
 * Saves an event, reporting whether it was a real event to save.
 *
 * The insert and the existence check are one statement so that saving something
 * already saved stays a success. `ON CONFLICT DO NOTHING` alone could not tell
 * that apart from an unknown id -- both write no row -- and the second time a
 * user tapped save they would be told the event does not exist.
 *
 * The snapshot is written here so that a save is self-sufficient from the moment
 * it exists, rather than only from whenever retention next runs. Re-saving
 * refreshes it: the row is already being touched, and the newer copy is by
 * definition the better fallback.
 */
export async function saveEvent(
  clerkUserId: string,
  eventId: string,
  database: Queryable = getPool(),
): Promise<boolean> {
  const result = await database.query<{ id: string }>(
    `WITH target AS (
       SELECT e.id, ${snapshotProjection}
       FROM events e
       LEFT JOIN venues v ON v.id = e.venue_id
       WHERE e.id = $2::uuid AND e.withdrawn_at IS NULL
     ), inserted AS (
       INSERT INTO saved_events (clerk_user_id, event_id, ${snapshotColumns})
       SELECT $1, id, ${snapshotColumns} FROM target
       ON CONFLICT (clerk_user_id, event_id) DO UPDATE SET ${snapshotExcluded}
       RETURNING event_id
     )
     SELECT id FROM target`,
    [clerkUserId, eventId],
  );
  return result.rows.length > 0;
}

/**
 * Removing a save that is not there is not an error, so this reports nothing.
 *
 * Matched on either key because an archived save has no `event_id` left to
 * address it by, and the list gives such a row its own id in that column. Both
 * are UUIDs from the same generator, so one parameter covers both without any
 * chance of a save id colliding with someone else's event id.
 */
export async function unsaveEvent(
  clerkUserId: string,
  eventId: string,
  database: Queryable = getPool(),
): Promise<void> {
  await database.query(
    `DELETE FROM saved_events
     WHERE clerk_user_id = $1 AND (event_id = $2::uuid OR id = $2::uuid)`,
    [clerkUserId, eventId],
  );
}
