CREATE TABLE IF NOT EXISTS user_preferences (
  clerk_user_id text PRIMARY KEY,
  home_address text NOT NULL,
  home_label text NOT NULL,
  home_latitude double precision NOT NULL CHECK (home_latitude BETWEEN -90 AND 90),
  home_longitude double precision NOT NULL CHECK (home_longitude BETWEEN -180 AND 180),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
