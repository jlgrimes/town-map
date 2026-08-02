ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS selected_games text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

ALTER TABLE user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_selected_games_check;

ALTER TABLE user_preferences
  ADD CONSTRAINT user_preferences_selected_games_check
  CHECK (selected_games <@ ARRAY['pokemon', 'magic', 'yugioh', 'onepiece', 'riftbound']::text[]);
