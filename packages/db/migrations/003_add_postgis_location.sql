CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS location geography(Point, 4326)
  GENERATED ALWAYS AS (
    CASE
      WHEN latitude IS NOT NULL AND longitude IS NOT NULL
        THEN ST_Point(longitude, latitude, 4326)::geography
      ELSE NULL
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS venues_location_gist_idx
  ON venues USING GIST (location);
