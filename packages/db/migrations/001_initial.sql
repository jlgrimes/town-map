CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  source_venue_id text NOT NULL,
  name text NOT NULL,
  address text,
  city text,
  region text,
  postal_code text,
  country text,
  latitude double precision,
  longitude double precision,
  website text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_venue_id)
);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  source_event_id text NOT NULL,
  game text NOT NULL CHECK (game IN ('pokemon', 'magic', 'yugioh')),
  venue_id uuid REFERENCES venues(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  timezone text,
  status text,
  format text,
  event_type text,
  registration_url text,
  price_amount numeric(10, 2),
  price_currency text,
  capacity integer,
  is_online boolean NOT NULL DEFAULT false,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_event_id)
);

CREATE INDEX IF NOT EXISTS events_game_starts_at_idx ON events (game, starts_at);
CREATE INDEX IF NOT EXISTS events_starts_at_idx ON events (starts_at);
CREATE INDEX IF NOT EXISTS venues_coordinates_idx ON venues (latitude, longitude);

CREATE TABLE IF NOT EXISTS sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  events_seen integer NOT NULL DEFAULT 0,
  events_written integer NOT NULL DEFAULT 0,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS sync_runs_source_started_idx ON sync_runs (source, started_at DESC);
