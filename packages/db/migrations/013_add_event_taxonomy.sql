-- Adding one event type meant editing four places in lockstep: the zod enum, the
-- events CHECK constraint, the label map, and the user_preferences CHECK. That
-- does not survive the move beyond card games, so the taxonomy becomes data.
--
-- Two tiers: a category is the vertical (card games, and later music, sports),
-- a game is the specific thing a user filters on. `events.game` and
-- `events.source` keep their names and stay text, so nothing on the wire or in
-- an already-shipped native client has to change.

CREATE TABLE IF NOT EXISTS categories (
  slug text PRIMARY KEY,
  label text NOT NULL,
  position integer NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS games (
  slug text PRIMARY KEY,
  category_slug text NOT NULL REFERENCES categories(slug) ON UPDATE CASCADE,
  label text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 100
);

CREATE INDEX IF NOT EXISTS games_category_idx ON games (category_slug);

CREATE TABLE IF NOT EXISTS sources (
  slug text PRIMARY KEY,
  label text NOT NULL,
  enabled boolean NOT NULL DEFAULT true
);

INSERT INTO categories (slug, label, position) VALUES
  ('card-game', 'Card games', 10)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO games (slug, category_slug, label, position) VALUES
  ('pokemon',   'card-game', 'Pokémon',   10),
  ('magic',     'card-game', 'Magic',     20),
  ('yugioh',    'card-game', 'Yu-Gi-Oh!', 30),
  ('onepiece',  'card-game', 'One Piece', 40),
  ('riftbound', 'card-game', 'Riftbound', 50)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO sources (slug, label) VALUES
  ('pokedata-events',   'Pokedata events export'),
  ('wotc-locator',      'Wizards Store and Event Locator'),
  ('konami-kcgn',       'KONAMI Card Game Network'),
  ('konami-events',     'KONAMI Events'),
  ('bandai-tcg-plus',   'Bandai TCG+'),
  ('riftbound-locator', 'Riftbound event locator')
ON CONFLICT (slug) DO NOTHING;

-- Adopt any value already present so validating the new keys cannot fail on
-- data written before this migration. The seeds above run first, so known
-- entries keep their proper labels and only unexpected ones fall back here.
INSERT INTO games (slug, category_slug, label)
SELECT DISTINCT game, 'card-game', game FROM events
ON CONFLICT (slug) DO NOTHING;

INSERT INTO sources (slug, label)
SELECT slug, slug FROM (
  SELECT DISTINCT source AS slug FROM events
  UNION SELECT DISTINCT source FROM venues
  UNION SELECT DISTINCT source FROM collection_regions
  UNION SELECT DISTINCT source FROM sync_runs
  UNION SELECT DISTINCT source FROM source_event_counts
) AS existing
ON CONFLICT (slug) DO NOTHING;

-- Referential integrity replaces the hardcoded CHECK constraints. Added NOT
-- VALID so this takes only a brief lock and no table scan; 014 validates them
-- separately under a lock that still allows reads and writes.
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_game_check;

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_game_fkey;
ALTER TABLE events ADD CONSTRAINT events_game_fkey
  FOREIGN KEY (game) REFERENCES games(slug) ON UPDATE CASCADE NOT VALID;

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_source_fkey;
ALTER TABLE events ADD CONSTRAINT events_source_fkey
  FOREIGN KEY (source) REFERENCES sources(slug) ON UPDATE CASCADE NOT VALID;

ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_source_fkey;
ALTER TABLE venues ADD CONSTRAINT venues_source_fkey
  FOREIGN KEY (source) REFERENCES sources(slug) ON UPDATE CASCADE NOT VALID;

ALTER TABLE collection_regions DROP CONSTRAINT IF EXISTS collection_regions_source_fkey;
ALTER TABLE collection_regions ADD CONSTRAINT collection_regions_source_fkey
  FOREIGN KEY (source) REFERENCES sources(slug) ON UPDATE CASCADE NOT VALID;

-- selected_games is an array, which cannot carry a foreign key. The hardcoded
-- CHECK is dropped rather than replaced: the API validates against this table.
ALTER TABLE user_preferences DROP CONSTRAINT IF EXISTS user_preferences_selected_games_check;
