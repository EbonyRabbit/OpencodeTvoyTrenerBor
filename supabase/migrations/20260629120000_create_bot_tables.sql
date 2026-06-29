-- Bot tables migration
-- Replaces: Bot State sheet, Bot Logs sheet, Bot Schedule sheet, Script Properties flags

-- =====================================================
-- 1. bot_state — Conversation states (replaces Bot State sheet)
-- =====================================================
CREATE TABLE bot_state (
  telegram_id   BIGINT PRIMARY KEY,
  client_id     UUID REFERENCES clients(id) ON DELETE CASCADE,
  action        TEXT,
  step          TEXT,
  data          JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_bot_state
  BEFORE UPDATE ON bot_state
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_bot_state_client_id ON bot_state(client_id);

-- =====================================================
-- 2. bot_logs — Bot logs (replaces Bot Logs sheet)
-- =====================================================
CREATE TABLE bot_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES clients(id) ON DELETE SET NULL,
  telegram_id BIGINT,
  action      TEXT NOT NULL,
  status      TEXT DEFAULT 'ok' CHECK (status IN ('ok', 'info', 'error', 'warning')),
  details     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bot_logs_created_at ON bot_logs(created_at DESC);
CREATE INDEX idx_bot_logs_client_id ON bot_logs(client_id);
CREATE INDEX idx_bot_logs_action ON bot_logs(action);

-- =====================================================
-- 3. bot_schedule — Scheduled reminders (replaces Bot Schedule sheet)
-- =====================================================
CREATE TABLE bot_schedule (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('measurement_reminder', 'resume_reminder', 'morning', 'evening')),
  scheduled   TIMESTAMPTZ NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'done', 'cancelled')),
  data        JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_bot_schedule
  BEFORE UPDATE ON bot_schedule
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_bot_schedule_scheduled ON bot_schedule(scheduled) WHERE status = 'pending';
CREATE INDEX idx_bot_schedule_client ON bot_schedule(client_id);
CREATE INDEX idx_bot_schedule_client_status ON bot_schedule(client_id, status);

-- =====================================================
-- 4. bot_dedup — Notification deduplication (replaces Script Properties flags)
-- =====================================================
CREATE TABLE bot_dedup (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bot_dedup_expires ON bot_dedup(expires_at);

-- NOTE: Run cleanup periodically (via pg_cron or bot cron job):
-- DELETE FROM bot_dedup WHERE expires_at < now();

-- =====================================================
-- 5. RLS policies
-- =====================================================
ALTER TABLE bot_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_dedup ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Full access to authenticated" ON bot_state FOR ALL TO authenticated USING (true);
CREATE POLICY "Full access to authenticated" ON bot_logs FOR ALL TO authenticated USING (true);
CREATE POLICY "Full access to authenticated" ON bot_schedule FOR ALL TO authenticated USING (true);
CREATE POLICY "Full access to authenticated" ON bot_dedup FOR ALL TO authenticated USING (true);

-- =====================================================
-- 6. GRANT permissions
-- =====================================================
-- Web-панель (authenticated)
GRANT SELECT, INSERT, UPDATE, DELETE ON bot_state TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON bot_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON bot_schedule TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON bot_dedup TO authenticated;

-- Бот (service_role)
GRANT ALL ON bot_state TO service_role;
GRANT ALL ON bot_logs TO service_role;
GRANT ALL ON bot_schedule TO service_role;
GRANT ALL ON bot_dedup TO service_role;
