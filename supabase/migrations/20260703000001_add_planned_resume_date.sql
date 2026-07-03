-- Migration: add_planned_resume_date
-- Description: Add planned_resume_date to plan_pauses for auto-resume cron + add 'resuming' status

ALTER TABLE plan_pauses
  ADD COLUMN IF NOT EXISTS planned_resume_date DATE;

-- Allow 'resuming' as intermediate status for optimistic locking
ALTER TABLE plan_pauses
  DROP CONSTRAINT IF EXISTS chk_pause_status;

ALTER TABLE plan_pauses
  ADD CONSTRAINT chk_pause_status CHECK (status IN ('active', 'resuming', 'completed'));

CREATE INDEX IF NOT EXISTS idx_plan_pauses_resume_date
  ON plan_pauses(planned_resume_date)
  WHERE status = 'active' AND planned_resume_date IS NOT NULL;
