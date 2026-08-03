-- migrate:no-transaction
-- Built CONCURRENTLY so indexing does not block collector writes on a live
-- database. Every statement is individually re-runnable because a failure here
-- leaves the migration unrecorded and it retries on the next deploy.

-- Serves a location query that also filters by game: leading equality on game,
-- then the bounding-box range. Partial because events without coordinates can
-- never satisfy a spatial query.
CREATE INDEX CONCURRENTLY IF NOT EXISTS events_game_geo_idx
  ON events (game, latitude, longitude, starts_at)
  WHERE latitude IS NOT NULL;

-- Serves the same query when no game filter is supplied, where the composite
-- above cannot be used because its leading column is unconstrained.
CREATE INDEX CONCURRENTLY IF NOT EXISTS events_geo_idx
  ON events (latitude, longitude, starts_at)
  WHERE latitude IS NOT NULL;
