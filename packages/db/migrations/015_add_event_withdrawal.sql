-- Events removed or cancelled upstream were never removed here, so a cancelled
-- tournament stayed on the map indefinitely.
--
-- `last_seen_at` cannot drive this: since collector writes became change-aware
-- it only advances when an event's content changes, so an unchanged event that
-- is still being observed looks identical to one that has disappeared. Instead
-- each event records the region that collected it, and a region that completes
-- successfully withdraws the upcoming events it owns but did not return.
--
-- Withdrawal is reversible and never deletes: the row is retained, excluded
-- from the read API, and cleared if the event is seen again.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS collection_region_id uuid REFERENCES collection_regions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;
