-- Add UNIQUE constraint on (client_id, date) for measurements upsert
-- First deduplicate: keep the most recent entry per (client_id, date)
DELETE FROM measurements a
USING measurements b
WHERE a.client_id = b.client_id
  AND a.date = b.date
  AND a.created_at < b.created_at;

DROP INDEX IF EXISTS idx_measurements_client_date;

CREATE UNIQUE INDEX idx_measurements_client_date_unique
  ON measurements(client_id, date);
