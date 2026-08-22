-- 21.11: крон напоминаний об истечении каждые 15 минут фильтрует активных
-- клиентов по окну access_end_date — добавляем частичный индекс.
CREATE INDEX IF NOT EXISTS idx_clients_access_end
  ON clients (access_end_date)
  WHERE status = 'active' AND access_end_date IS NOT NULL;
