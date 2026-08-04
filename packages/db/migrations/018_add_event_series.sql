-- Most store events repeat: the same Friday night tournament appears as a fresh
-- upstream record every week. Occurrences stay as separate rows, because each
-- carries its own time, price and capacity, and collectors are idempotent on
-- (source, source_event_id). What is missing is the grouping between them.
--
-- Identity and grouping are separated deliberately:
--
--   event_series       stable identity. This is what a user will eventually
--                      follow, so it must survive a store nudging the start
--                      time or renaming the event.
--   event_series_keys  the deterministic keys that map occurrences onto a
--                      series. A key is derived from the occurrence itself, so
--                      grouping is a pure function and does not depend on the
--                      order events arrive in.
--
-- A series may own several keys. When a schedule drifts, the new key is
-- attached to the existing series rather than forking a new one, which is what
-- keeps a subscription pointing at the same thing.

CREATE TABLE IF NOT EXISTS event_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL REFERENCES sources(slug) ON UPDATE CASCADE,
  game text NOT NULL REFERENCES games(slug) ON UPDATE CASCADE,
  venue_id uuid REFERENCES venues(id) ON DELETE SET NULL,
  -- Descriptive, refreshed from the most recent occurrence. Titles drift
  -- ("FNM", "Friday Night Magic #42"), so they describe a series but never
  -- identify one.
  title text NOT NULL,
  format text,
  -- The local schedule. Stored in the venue's own time because a UTC weekday
  -- and time shift by an hour across daylight saving, which would split every
  -- weekly series in two, twice a year.
  timezone text,
  weekday smallint CHECK (weekday BETWEEN 0 AND 6),
  local_start_minute smallint CHECK (local_start_minute BETWEEN 0 AND 1439),
  -- Observed rather than declared. Null until enough occurrences have been seen
  -- to call it: two events a week apart are not yet a pattern.
  cadence_days integer,
  occurrence_count integer NOT NULL DEFAULT 0,
  first_starts_at timestamptz,
  last_starts_at timestamptz,
  next_starts_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_series_keys (
  source text NOT NULL REFERENCES sources(slug) ON UPDATE CASCADE,
  key text NOT NULL,
  series_id uuid NOT NULL REFERENCES event_series(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, key)
);

ALTER TABLE events
  -- Assigned by a pass after ingest, never by the collector write itself, so
  -- the change-aware upsert on the hot path is untouched.
  ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES event_series(id) ON DELETE SET NULL,
  -- A series identifier supplied by the upstream source. Bandai provides one;
  -- where present it is authoritative and beats anything derived.
  ADD COLUMN IF NOT EXISTS source_series_id text;
