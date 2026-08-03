-- Event lookup filters on time and game (columns on `events`) but on geography
-- (columns on `venues`). No index can span that join, so a location query
-- degenerates into a nested loop that rescans the category slice of
-- events_game_starts_at_idx once per candidate venue.
--
-- Copying the venue coordinates onto the event lets one index serve the whole
-- predicate. Collectors rewrite these columns on every upsert, so they converge
-- on the venue within one collection cycle if a venue is ever relocated.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

UPDATE events e
SET latitude = v.latitude,
    longitude = v.longitude
FROM venues v
WHERE v.id = e.venue_id
  AND e.latitude IS NULL
  AND v.latitude IS NOT NULL;
