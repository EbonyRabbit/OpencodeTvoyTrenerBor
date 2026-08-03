CREATE INDEX IF NOT EXISTS idx_workout_logs_client_exercise_date
  ON workout_logs (client_id, exercise, date DESC);
