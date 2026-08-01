ALTER TABLE events DROP CONSTRAINT IF EXISTS events_game_check;

ALTER TABLE events
  ADD CONSTRAINT events_game_check
  CHECK (game IN ('pokemon', 'magic', 'yugioh', 'onepiece', 'riftbound'));
