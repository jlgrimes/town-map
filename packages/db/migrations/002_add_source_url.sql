ALTER TABLE events
ADD COLUMN IF NOT EXISTS source_url text;

UPDATE events
SET source_url = registration_url,
    registration_url = NULL
WHERE source = 'pokedata-events'
  AND source_url IS NULL
  AND registration_url IS NOT NULL;

UPDATE events
SET source_url = 'https://locator.wizards.com/event/' || source_event_id
WHERE source = 'wotc-locator'
  AND source_url IS NULL;

UPDATE events
SET source_url = 'https://cardgame-network.konami.net/tournament_info/' || source_event_id
WHERE source = 'konami-kcgn'
  AND source_url IS NULL;
