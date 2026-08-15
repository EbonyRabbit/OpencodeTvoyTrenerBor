-- Migration: exercise_library
-- Description: Расширить exercises контентом библиотеки упражнений:
-- description/technique/features (ru/en), aliases, video_url и name_key
-- (нормализованное имя для связывания с упражнениями программ).

-- ⚠️ normalize в SQL ниже — упрощённый аналог normalizeExerciseName()
-- из web/src/lib/exercise-library.ts и bot/src/lib/exercise-library.ts
-- (оба файла должны оставаться в синке). SQL-версия грубее (только
-- a-z0-9а-я), JS-версия использует \p{L}\p{N}; для реальных названий
-- результаты совпадают.

-- 1. Новые колонки (nullable, чтобы безопасно работать на непустой таблице)
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS name_key TEXT;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS description_ru TEXT;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS description_en TEXT;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS technique_ru TEXT;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS technique_en TEXT;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS features_ru TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS features_en TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS video_url TEXT;

-- 2. Backfill name_key из существующих name (если таблица непустая).
--    ВАЖНО: lower() ДО regexp_replace — заглавные кириллические буквы
--    (П, С, Ж...) не входят в диапазон [а-я] и были бы вырезаны.
UPDATE exercises
SET name_key = regexp_replace(
  regexp_replace(lower(name), '[ё]', 'е', 'g'),
  '[^a-z0-9а-я]',
  '',
  'g'
)
WHERE name_key IS NULL;

-- 3. Дедупликация перед UNIQUE (защита от коллизий normalize на legacy-данных;
--    для пустой таблицы — no-op). Оставляем строку с наименьшим id.
--    Пустые name_key исключаем из дедупа, но ниже получают уникальные ключи
--    'ex_<id>' — чтобы UNIQUE-констрейнт не падал при нескольких таких строках.
DELETE FROM exercises a
USING exercises b
WHERE a.id > b.id
  AND a.name_key = b.name_key
  AND a.name_key IS NOT NULL
  AND a.name_key <> '';

-- 3a. Имена, нормализующиеся в пустоту (например, «###»), получают уникальный
--     ключ по id. Такие записи не участвуют в матчинге, но не ломают UNIQUE
--     и не удаляются.
UPDATE exercises
SET name_key = 'ex_' || replace(id::text, '-', '')
WHERE name_key = '';

-- 4. NOT NULL + UNIQUE
ALTER TABLE exercises ALTER COLUMN name_key SET NOT NULL;
ALTER TABLE exercises ADD CONSTRAINT exercises_name_key_key UNIQUE (name_key);

-- 5. Индекс для поиска по алиасам (GIN)
CREATE INDEX IF NOT EXISTS idx_exercises_aliases ON exercises USING GIN (aliases);

-- 6. Минимизация прав: запись в библиотеку — только через service_role
--    (веб-actions с проверкой роли admin/coach и бот). Роль authenticated
--    (клиентский портал, автокомплит в редакторе программ) — только чтение:
--    убираем доступ только к DML и заменяем политику "FOR ALL" на "FOR SELECT",
--    чтобы будущий повторный GRANT DML не открыл запись по старой политике.
REVOKE INSERT, UPDATE, DELETE ON exercises FROM authenticated;

DROP POLICY IF EXISTS "Exercises: all access for authenticated" ON exercises;
CREATE POLICY "Exercises: read for authenticated"
  ON exercises
  FOR SELECT
  TO authenticated
  USING (true);

-- Комментарии
COMMENT ON COLUMN exercises.name_key IS 'Нормализованное имя для связывания с упражнениями программ (lowercase, без пунктуации; аналог normalizeExerciseName из exercise-library.ts)';
COMMENT ON COLUMN exercises.aliases IS 'Алиасы для матчинга: варианты названий, дети суперсетов';
COMMENT ON COLUMN exercises.video_url IS 'YouTube-ссылка на демонстрацию техники (NULL — видео нет)';