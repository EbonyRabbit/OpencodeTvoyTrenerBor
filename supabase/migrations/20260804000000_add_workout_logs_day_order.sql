-- workout_logs: pin each log to its planned day (day_order) for exact
-- counting of completed workouts and history grouping.
ALTER TABLE workout_logs ADD COLUMN day_order INTEGER;
