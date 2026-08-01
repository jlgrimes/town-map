ALTER TABLE user_preferences
  ALTER COLUMN home_label DROP NOT NULL,
  ALTER COLUMN home_latitude DROP NOT NULL,
  ALTER COLUMN home_longitude DROP NOT NULL;
