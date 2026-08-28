-- Migration: add_program_sport
-- Description: Добавить поле sport (вид спорта) для спорт-специфичных шаблонов
-- программ (теннис, бег, триатлон, плавание и т.д.). Существующие программы
-- (напр. HYROX) остаются со sport = NULL и продолжают отображаться в каталоге.

ALTER TABLE programs ADD COLUMN IF NOT EXISTS sport TEXT
  CHECK (sport IS NULL OR sport IN ('tennis', 'running', 'triathlon', 'swimming', 'hyrox', 'general'));

CREATE INDEX IF NOT EXISTS idx_programs_sport ON programs (sport);
