-- migrate:no-transaction
-- Built CONCURRENTLY so indexing does not block collector writes on a live
-- database. Every statement is individually re-runnable because a failure here
-- leaves the migration unrecorded and it retries on the next deploy.

-- Serves the withdrawal sweep, which scopes to one region's upcoming events.
CREATE INDEX CONCURRENTLY IF NOT EXISTS events_region_starts_at_idx
  ON events (collection_region_id, starts_at)
  WHERE withdrawn_at IS NULL;

-- The read path now also filters on withdrawn_at, so the geography indexes are
-- rebuilt to carry that predicate. Withdrawn rows are never served and would
-- otherwise keep taking up space in the index that answers every map query.
CREATE INDEX CONCURRENTLY IF NOT EXISTS events_game_geo_live_idx
  ON events (game, latitude, longitude, starts_at)
  WHERE latitude IS NOT NULL AND withdrawn_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS events_geo_live_idx
  ON events (latitude, longitude, starts_at)
  WHERE latitude IS NOT NULL AND withdrawn_at IS NULL;

DROP INDEX CONCURRENTLY IF EXISTS events_game_geo_idx;
DROP INDEX CONCURRENTLY IF EXISTS events_geo_idx;
