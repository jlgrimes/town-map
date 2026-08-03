-- `events.raw` holds the full upstream payload. It is large, it is rewritten
-- whenever an event changes, and comparing it dominates the change detection
-- that decides whether a row needs writing at all. None of the read paths touch
-- it: it exists for debugging and future reprocessing.
--
-- Moving it to a side table keeps the payload without carrying it through every
-- query plan, index and row rewrite on the table the API actually reads.
--
-- Note on the deploy: collectors stop writing events.raw in the same release
-- that drops it. A collector run already in flight when the migration lands
-- fails once and retries on its next cron tick; the API never reads the column.

CREATE TABLE IF NOT EXISTS event_raw (
  event_id uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  raw jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO event_raw (event_id, raw)
SELECT id, raw FROM events
ON CONFLICT (event_id) DO NOTHING;

ALTER TABLE events DROP COLUMN IF EXISTS raw;
