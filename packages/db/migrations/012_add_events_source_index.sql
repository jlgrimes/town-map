-- migrate:no-transaction
-- Built CONCURRENTLY so indexing does not block collector writes on a live
-- database. Every statement is individually re-runnable because a failure here
-- leaves the migration unrecorded and it retries on the next deploy.

-- Serves the per-source recount behind source_event_counts, which would
-- otherwise scan the whole events heap once per collection run.
CREATE INDEX CONCURRENTLY IF NOT EXISTS events_source_starts_at_idx
  ON events (source, starts_at);
