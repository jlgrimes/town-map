-- A save was a pointer and nothing else: `event_id`, `saved_at`, and a cascade.
-- Retention deleting a past event therefore deleted the save with it, so
-- "My events" could only ever be a forward-looking list and the app kept no
-- record of anywhere anyone had actually been.
--
-- The save now carries enough of the event to render on its own. The snapshot is
-- a fallback rather than a second source of truth: while the event row still
-- exists the read path prefers it, so an organiser moving the venue is reflected
-- in a save made before the move. The snapshot is what the row degrades into
-- when the event is deleted, frozen at whatever was last known, and retention
-- refreshes it immediately before deleting so "last known" means last known
-- rather than whatever happened to be true on the day it was saved.
--
-- Series are deliberately not snapshotted. A series summary answers "how often
-- does this recur", which is a question about a live thing; on a frozen record
-- of one occurrence that already happened it has nothing to say.

-- `event_id` has to become nullable for `ON DELETE SET NULL`, and a nullable
-- column cannot sit in a primary key, so identity moves to a surrogate. The old
-- pair becomes a unique constraint, which still backs the `ON CONFLICT` in
-- `saveEvent`. NULLs are distinct in a unique index by default, so any number of
-- archived saves coexist without colliding.
ALTER TABLE saved_events ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE saved_events DROP CONSTRAINT IF EXISTS saved_events_pkey;
ALTER TABLE saved_events ADD PRIMARY KEY (id);
ALTER TABLE saved_events ADD CONSTRAINT saved_events_user_event_key UNIQUE (clerk_user_id, event_id);

ALTER TABLE saved_events ALTER COLUMN event_id DROP NOT NULL;
ALTER TABLE saved_events DROP CONSTRAINT IF EXISTS saved_events_event_id_fkey;
ALTER TABLE saved_events ADD CONSTRAINT saved_events_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL;

-- Mirrors the columns the read path projects, so a row with no event behind it
-- still produces a complete list item. `withdrawn_at` is among them because a
-- cancelled event must stay hidden after its row is gone too: without it, a
-- withdrawn event would reappear a year later as something the user attended.
ALTER TABLE saved_events
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS source_event_id text,
  ADD COLUMN IF NOT EXISTS game text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS format text,
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS registration_url text,
  ADD COLUMN IF NOT EXISTS price_amount numeric(10, 2),
  ADD COLUMN IF NOT EXISTS price_currency text,
  ADD COLUMN IF NOT EXISTS capacity integer,
  ADD COLUMN IF NOT EXISTS is_online boolean,
  ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz,
  ADD COLUMN IF NOT EXISTS venue_name text,
  ADD COLUMN IF NOT EXISTS venue_address text,
  ADD COLUMN IF NOT EXISTS venue_city text,
  ADD COLUMN IF NOT EXISTS venue_region text,
  ADD COLUMN IF NOT EXISTS venue_postal_code text,
  ADD COLUMN IF NOT EXISTS venue_latitude double precision,
  ADD COLUMN IF NOT EXISTS venue_longitude double precision,
  ADD COLUMN IF NOT EXISTS venue_website text;

-- Every existing save still points at a live event, because until this migration
-- it could not do anything else, so the join covers the whole table.
UPDATE saved_events se SET
  source = e.source,
  source_event_id = e.source_event_id,
  game = e.game,
  title = e.title,
  description = e.description,
  starts_at = e.starts_at,
  ends_at = e.ends_at,
  timezone = e.timezone,
  status = e.status,
  format = e.format,
  event_type = e.event_type,
  source_url = e.source_url,
  registration_url = e.registration_url,
  price_amount = e.price_amount,
  price_currency = e.price_currency,
  capacity = e.capacity,
  is_online = e.is_online,
  withdrawn_at = e.withdrawn_at,
  venue_name = v.name,
  venue_address = v.address,
  venue_city = v.city,
  venue_region = v.region,
  venue_postal_code = v.postal_code,
  venue_latitude = v.latitude,
  venue_longitude = v.longitude,
  venue_website = v.website
FROM events e
LEFT JOIN venues v ON v.id = e.venue_id
WHERE se.event_id = e.id;

-- Enforced only for the columns a list item cannot be rendered without. The rest
-- are nullable on `events` too and stay that way here.
ALTER TABLE saved_events
  ALTER COLUMN source SET NOT NULL,
  ALTER COLUMN source_event_id SET NOT NULL,
  ALTER COLUMN game SET NOT NULL,
  ALTER COLUMN title SET NOT NULL,
  ALTER COLUMN starts_at SET NOT NULL,
  ALTER COLUMN is_online SET NOT NULL;

-- The list reads one user's saves ordered by date and is now unbounded in the
-- past, so it grows for as long as someone keeps using the app. Ordering it from
-- the index keeps that read flat rather than sorting a lifetime of saves.
CREATE INDEX IF NOT EXISTS saved_events_user_starts_at_idx
  ON saved_events (clerk_user_id, starts_at DESC);
