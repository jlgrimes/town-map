-- Separated from 013 so the scan runs in its own transaction. VALIDATE takes
-- SHARE UPDATE EXCLUSIVE, which still allows reads and writes, whereas holding
-- it alongside the ADD CONSTRAINT would extend that statement's stronger lock.

ALTER TABLE events VALIDATE CONSTRAINT events_game_fkey;
ALTER TABLE events VALIDATE CONSTRAINT events_source_fkey;
ALTER TABLE venues VALIDATE CONSTRAINT venues_source_fkey;
ALTER TABLE collection_regions VALIDATE CONSTRAINT collection_regions_source_fkey;
