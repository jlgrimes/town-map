-- migrate:no-transaction
-- Built CONCURRENTLY so indexing does not block collector writes on a live
-- database. Every statement is individually re-runnable because a failure here
-- leaves the migration unrecorded and it retries on the next deploy.

-- The assignment pass looks for occurrences that have no series yet.
CREATE INDEX CONCURRENTLY IF NOT EXISTS events_unassigned_series_idx
  ON events (source, starts_at)
  WHERE series_id IS NULL AND withdrawn_at IS NULL;

-- Listing the occurrences of one series, and refreshing its statistics.
CREATE INDEX CONCURRENTLY IF NOT EXISTS events_series_starts_at_idx
  ON events (series_id, starts_at)
  WHERE series_id IS NOT NULL;

-- Reconciling a drifted key looks for a sibling on the same local schedule.
CREATE INDEX CONCURRENTLY IF NOT EXISTS event_series_schedule_idx
  ON event_series (source, venue_id, game, weekday);
