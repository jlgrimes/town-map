CREATE INDEX IF NOT EXISTS events_venue_id_idx
  ON events (venue_id)
  WHERE venue_id IS NOT NULL;
