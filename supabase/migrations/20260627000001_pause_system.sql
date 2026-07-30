-- Migration: pause_system
-- Description: Add plan_pauses table and original_* + is_deload columns to program_schedule

CREATE TABLE plan_pauses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  pause_start   DATE NOT NULL,
  pause_end     DATE,
  reason        TEXT NOT NULL DEFAULT 'other',
  strategy      TEXT DEFAULT 'shift',
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_pause_reason CHECK (reason IN ('sick', 'vacation', 'injury', 'personal', 'other')),
  CONSTRAINT chk_pause_strategy CHECK (strategy IN ('skip', 'shift', 'deload', 'rollback')),
  CONSTRAINT chk_pause_status CHECK (status IN ('active', 'completed'))
);

ALTER TABLE program_schedule
  ADD COLUMN original_start_date DATE,
  ADD COLUMN original_end_date DATE,
  ADD COLUMN is_deload BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_plan_pauses_client_id ON plan_pauses(client_id);
CREATE INDEX idx_plan_pauses_status ON plan_pauses(status);

ALTER TABLE plan_pauses ENABLE ROW LEVEL SECURITY;

CREATE POLICY plan_pauses_admin_all ON plan_pauses
  FOR ALL TO authenticated
  USING (true);

CREATE TRIGGER set_updated_at_plan_pauses
  BEFORE UPDATE ON plan_pauses
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
