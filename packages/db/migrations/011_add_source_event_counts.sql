-- `GET /v1/coverage` counted upcoming events per source on every request, which
-- is a full scan of `events` on a public, unauthenticated endpoint.
--
-- The count cannot be maintained incrementally: an event stops being upcoming
-- as time passes, with no write to hang a trigger on. So it is recomputed off
-- the request path after each successful collection run and read as a snapshot,
-- with `computed_at` exposed so the staleness is visible rather than implied.

CREATE TABLE IF NOT EXISTS source_event_counts (
  source text PRIMARY KEY,
  upcoming_events integer NOT NULL CHECK (upcoming_events >= 0),
  computed_at timestamptz NOT NULL DEFAULT now()
);
