-- Фаза 24: персональные замены упражнений клиента.
-- Шаблон программы (programs.parsed_content) не меняется никогда:
-- замены живут здесь и накладываются поверх при показе тренировки.
-- Ключ — нормализованное имя оригинала (lowercase, trim, ё→е),
-- поэтому одна строка действует во всех неделях и днях навсегда.

CREATE TABLE client_exercise_swaps (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  exercise_key     TEXT NOT NULL,
  original_name    TEXT NOT NULL,
  replacement_name TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT client_exercise_swaps_unique_client_key UNIQUE (client_id, exercise_key),
  CONSTRAINT client_exercise_swaps_key_not_empty CHECK (char_length(btrim(exercise_key)) > 0),
  CONSTRAINT client_exercise_swaps_original_not_empty CHECK (char_length(btrim(original_name)) > 0),
  CONSTRAINT client_exercise_swaps_replacement_not_empty CHECK (char_length(btrim(replacement_name)) > 0)
);

CREATE INDEX idx_client_exercise_swaps_client
  ON client_exercise_swaps (client_id);

CREATE TRIGGER set_updated_at_client_exercise_swaps
  BEFORE UPDATE ON client_exercise_swaps
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE client_exercise_swaps ENABLE ROW LEVEL SECURITY;

-- Конвенция как у bot_state/bot_logs: бот и веб-экшены ходят под service_role,
-- authenticated (тренерская вебка) — полный доступ, удаление клиента чистит строки каскадом.
GRANT SELECT, INSERT, UPDATE, DELETE ON client_exercise_swaps TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_exercise_swaps TO service_role;

DROP POLICY IF EXISTS "Full access to authenticated" ON client_exercise_swaps;
CREATE POLICY "Full access to authenticated" ON client_exercise_swaps
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE client_exercise_swaps IS 'Фаза 24: персональные замены упражнений (оригинал → замена), действуют навсегда во всех неделях. programs.parsed_content не меняется.';
COMMENT ON COLUMN client_exercise_swaps.exercise_key IS 'Нормализованное имя оригинала: lowercase, trim, ё→е (см. normalizeExerciseKey в exercise-swaps.ts)';
COMMENT ON COLUMN client_exercise_swaps.original_name IS 'Человекочитаемое имя оригинала для вебки тренера';
