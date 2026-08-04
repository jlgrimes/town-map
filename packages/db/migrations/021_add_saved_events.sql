-- "My events" is the first screen the app opens on, so a save has to outlive the
-- session that made it. The row is keyed on the Clerk user id rather than a
-- local account: there is no users table, and `user_preferences` already treats
-- that id as the identity.
--
-- Occurrences are saved, not series. Following a series is the better long-term
-- primitive and 018 built the identity for it, but it answers a different
-- question -- "show me this every week" rather than "I am going to that one" --
-- and wants its own table rather than an overloaded column here.
--
-- Deliberately cascading: retention deletes events once they are past, and a
-- save that outlived its event would be a row pointing at nothing. The cost is
-- that "My events" is a forward-looking list and keeps no attendance history.

CREATE TABLE IF NOT EXISTS saved_events (
  clerk_user_id text NOT NULL,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clerk_user_id, event_id)
);

-- The primary key already serves "everything this user saved", because
-- clerk_user_id leads it. This covers the other direction: retention deletes
-- past events in batches, and each delete has to find the rows referencing it.
-- Without this the cascade is a sequential scan of saved_events per event.
CREATE INDEX IF NOT EXISTS saved_events_event_id_idx ON saved_events (event_id);
