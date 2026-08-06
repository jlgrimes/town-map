-- `events.timezone` is free text copied from whatever the upstream source
-- published, and 018 started feeding it to `AT TIME ZONE` to derive a series'
-- local weekday and start time. PostgreSQL raises `invalid_parameter_value` for
-- a string it does not recognise as a zone, and the whole assignment pass runs
-- in one transaction, so a single unusable value stopped every occurrence of
-- that source from ever being grouped -- and, because the offending rows stay
-- unassigned, failed again on every subsequent run.
--
-- The Wizards locator is the source that reached that state: it publishes
-- `timeZone` as free text and sends blanks, which `COALESCE(timezone, 'UTC')`
-- does not catch.
--
-- Two parts: a function that reports whether a value is usable as a zone, so
-- the assignment pass can fall back instead of aborting, and a backfill that
-- clears the values already stored.

-- Asking PostgreSQL to interpret the value is the only check that matches what
-- `AT TIME ZONE` itself accepts: the set is wider than `pg_timezone_names`,
-- which holds neither abbreviations like `EST` nor offsets like `UTC-05:00`.
-- STRICT so a NULL zone returns NULL without entering the block, and the
-- handler is narrowed to the one condition an unrecognised zone raises rather
-- than swallowing unrelated errors.
CREATE OR REPLACE FUNCTION resolved_timezone(candidate text) RETURNS text
LANGUAGE plpgsql STABLE STRICT AS $$
BEGIN
  PERFORM timestamptz '2000-01-01 00:00:00+00' AT TIME ZONE candidate;
  RETURN candidate;
EXCEPTION WHEN invalid_parameter_value THEN
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION resolved_timezone(text) IS
  'Returns the argument when AT TIME ZONE accepts it as a zone, otherwise NULL.';

-- Stored values that no longer mean anything. Null rather than corrected: the
-- collector cannot know which zone a blank was meant to be, and null is what
-- every other source already writes when it has no zone to offer.
UPDATE events
SET timezone = NULL, updated_at = now()
WHERE timezone IS NOT NULL
  AND resolved_timezone(timezone) IS NULL;

-- The same value was copied onto saves by 022. Nothing dereferences it as a
-- zone today, but leaving it would freeze the bad string into records that
-- outlive the event they were snapshotted from.
UPDATE saved_events
SET timezone = NULL
WHERE timezone IS NOT NULL
  AND resolved_timezone(timezone) IS NULL;
