-- Панельная «Ссылка на оплату» (21.9): одна pending-заявка на пару
-- (клиент панели, программа). Заявки бота без привязки (client_id IS NULL)
-- продолжают покрываться индексом из 20260817000000 по (telegram_id, program_id).

-- Перед созданием уникального индекса гасим существующие дубли:
-- оставляем последнюю заявку, старые отменяем.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY client_id, program_id
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM purchase_requests
  WHERE status = 'pending'
    AND client_id IS NOT NULL
)
UPDATE purchase_requests
SET status = 'cancelled'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS purchase_unique_pending_client_program
  ON purchase_requests (client_id, program_id)
  WHERE status = 'pending';

-- Примечание: индекс сознательно не фильтрует sub_type — сейчас заявки
-- только 'program'/'individ' и individ-заявки создаются с client_id IS NULL;
-- при появлении новых типов пересмотреть предикат.
