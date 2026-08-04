-- migrate:no-transaction
-- Text search ran in the browser over the events one query had already
-- gathered, so it could only ever match within the page ceiling the client
-- stops at. In a dense metropolitan area a matching event beyond that cutoff
-- simply did not exist as far as the search box was concerned.
--
-- Moving the filter into the same predicate that already narrows on time, game
-- and location means the match is made against every candidate event rather
-- than against the prefix that happened to be fetched.
--
-- `search_text` follows the precedent set for coordinates in 009: the venue
-- name and address are copied onto the event so a single index over `events`
-- serves the predicate without joining `venues` across the candidate set.
-- Collectors rewrite it on every upsert, so a renamed venue converges within
-- one collection cycle.
--
-- Every statement is individually re-runnable because a failure here leaves the
-- migration unrecorded and it retries on the next deploy.

ALTER TABLE events ADD COLUMN IF NOT EXISTS search_text text;

-- Backfill so search works against existing rows before the collectors next
-- run. `game` contributes with its hyphens split so that a slug like
-- `flesh-and-blood` is reachable by typing the words.
UPDATE events e
SET search_text = concat_ws(' ',
      e.title, replace(e.game, '-', ' '), e.format, e.event_type,
      v.name, v.address, v.city, v.region)
FROM venues v
WHERE v.id = e.venue_id
  AND e.search_text IS NULL;

-- Events with no venue are backfilled separately: the join above drops them.
UPDATE events
SET search_text = concat_ws(' ', title, replace(game, '-', ' '), format, event_type)
WHERE search_text IS NULL;

-- An expression index rather than a generated column: adding a stored generated
-- column rewrites the whole table under an ACCESS EXCLUSIVE lock, which this
-- avoids. The expression is duplicated in the query that uses it, so the two
-- are kept in one place in `packages/db/src/index.ts` as EVENT_SEARCH_VECTOR.
--
-- Built CONCURRENTLY so indexing does not block collector writes on a live
-- database, and predicated on the same withdrawal clause the event query
-- carries so the index holds only servable rows.
CREATE INDEX CONCURRENTLY IF NOT EXISTS events_search_text_idx
  ON events USING GIN (to_tsvector('english', coalesce(search_text, '')))
  WHERE withdrawn_at IS NULL;
