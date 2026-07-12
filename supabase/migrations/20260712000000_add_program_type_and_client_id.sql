-- Migration: add_program_type_and_client_id
-- Description: Добавить type (NOT NULL DEFAULT 'template') и client_id (FK → clients)
-- в таблицу programs для поддержки персональных программ.

-- 1. Установить default и backfill существующих NULL значений
ALTER TABLE programs ALTER COLUMN type SET DEFAULT 'template';
UPDATE programs SET type = 'template' WHERE type IS NULL;
ALTER TABLE programs ALTER COLUMN type SET NOT NULL;

-- 2. CHECK constraint — допустимые значения
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_program_type'
  ) THEN
    ALTER TABLE programs
      ADD CONSTRAINT chk_program_type CHECK (type IN ('template', 'personal'));
  END IF;
END $$;

-- 3. Добавить client_id (nullable — template-программы не привязаны к клиенту)
ALTER TABLE programs ADD COLUMN IF NOT EXISTS client_id UUID;

-- 4. Foreign key (ON DELETE SET NULL — при удалении клиента программа остаётся шаблоном)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'programs_client_id_fkey'
  ) THEN
    ALTER TABLE programs
      ADD CONSTRAINT programs_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES clients(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 5. Индексы
CREATE INDEX IF NOT EXISTS idx_programs_type ON programs(type);
CREATE INDEX IF NOT EXISTS idx_programs_client_id ON programs(client_id) WHERE client_id IS NOT NULL;

-- Комментарии
COMMENT ON COLUMN programs.type IS 'Тип программы: template (шаблон) или personal (персональная для клиента)';
COMMENT ON COLUMN programs.client_id IS 'UUID клиента, которому принадлежит персональная программа (NULL для шаблонов)';
