-- Welcome followups paginate by (action, created_at, id) with keyset and
-- look up followup history by recipient.
CREATE INDEX IF NOT EXISTS idx_bot_logs_action_created_at_id
  ON bot_logs (action, created_at, id);
CREATE INDEX IF NOT EXISTS idx_bot_logs_telegram_action_created
  ON bot_logs (telegram_id, action, created_at);
