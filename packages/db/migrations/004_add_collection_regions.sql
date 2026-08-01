CREATE TABLE IF NOT EXISTS collection_regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  region_key text NOT NULL,
  label text NOT NULL,
  country_code text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  cadence_minutes integer NOT NULL DEFAULT 360 CHECK (cadence_minutes BETWEEN 15 AND 10080),
  next_run_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_started_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, region_key)
);

CREATE INDEX IF NOT EXISTS collection_regions_due_idx
  ON collection_regions (source, priority, next_run_at)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS collection_regions_lease_idx
  ON collection_regions (lease_expires_at)
  WHERE lease_owner IS NOT NULL;

ALTER TABLE sync_runs
  ADD COLUMN IF NOT EXISTS collection_region_id uuid REFERENCES collection_regions(id) ON DELETE SET NULL;

ALTER TABLE sync_runs
  ADD COLUMN IF NOT EXISTS region_key text;

CREATE INDEX IF NOT EXISTS sync_runs_region_started_idx
  ON sync_runs (collection_region_id, started_at DESC);
