-- Отдельная миграция исправляет precision и в средах, где предыдущая
-- версия add_workout_logs_metrics уже была отмечена как применённая.
ALTER TABLE public.workout_logs
  ALTER COLUMN heart_rate TYPE NUMERIC(4, 1)
  USING heart_rate::NUMERIC(4, 1);
