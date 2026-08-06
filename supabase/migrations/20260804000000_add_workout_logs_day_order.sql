-- workout_logs: pin each log to its planned day (day_order) for exact
-- counting of completed workouts and history grouping.
-- IF NOT EXISTS: idempotent, because the column already exists on
-- environments where the change was applied manually before this migration.
ALTER TABLE workout_logs ADD COLUMN IF NOT EXISTS day_order INTEGER;
