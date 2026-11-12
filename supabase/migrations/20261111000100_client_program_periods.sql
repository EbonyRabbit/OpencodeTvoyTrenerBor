-- Migration: client program periods (Phase 30.4)
-- A period is one usage of a program by a client. History (logs, schedule,
-- weight hints) filters by the active program_period_id; switching programs —
-- or re-picking the same one — starts a NEW period and resets weights.
-- Health data (measurements, checkins, photos) is intentionally untouched.

-- 1. Periods: one active per client, history preserved forever.
CREATE TABLE client_program_periods (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  program_id   UUID REFERENCES programs(id) ON DELETE SET NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at     TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE client_program_periods IS 'One row per client x program usage; workout_logs/program_schedule filter by the active period';
COMMENT ON COLUMN client_program_periods.started_at IS 'Period start; weights/e1RM history of the period counts from here';
COMMENT ON COLUMN client_program_periods.ended_at IS 'Period end; NULL while active';

CREATE UNIQUE INDEX idx_client_program_periods_one_active
  ON client_program_periods (client_id)
  WHERE status = 'active';

CREATE INDEX idx_client_program_periods_client_id
  ON client_program_periods (client_id);

CREATE TRIGGER set_updated_at_client_program_periods
  BEFORE UPDATE ON client_program_periods
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- 2. Stamp logs and schedule with the owning program/period.
ALTER TABLE workout_logs
  ADD COLUMN program_id UUID REFERENCES programs(id) ON DELETE SET NULL,
  ADD COLUMN program_period_id UUID REFERENCES client_program_periods(id) ON DELETE SET NULL;

ALTER TABLE program_schedule
  ADD COLUMN program_id UUID REFERENCES programs(id) ON DELETE SET NULL,
  ADD COLUMN program_period_id UUID REFERENCES client_program_periods(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_workout_logs_period
  ON workout_logs (program_period_id);
CREATE INDEX IF NOT EXISTS idx_program_schedule_period
  ON program_schedule (program_period_id);

COMMENT ON COLUMN workout_logs.program_id IS 'Program the log belongs to (backfilled from clients.program_id)';
COMMENT ON COLUMN workout_logs.program_period_id IS 'Program period the log belongs to; history filters by the active one';
COMMENT ON COLUMN program_schedule.program_id IS 'Program the schedule week belongs to (backfilled from clients.program_id)';
COMMENT ON COLUMN program_schedule.program_period_id IS 'Program period the schedule week belongs to; archiving keeps old rows';

-- 3. Backfill: one active period per client that has a program assigned.
--    Started from the earliest log (or now when no logs); logs and schedule
--    rows of that client are stamped with the period. Health data is skipped.
DO $$
DECLARE
  v_period uuid;
  v_client_id uuid;
  v_program_id uuid;
BEGIN
  FOR v_client_id, v_program_id IN
    SELECT c.id, c.program_id
    FROM public.clients c
    WHERE c.program_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.client_program_periods p
        WHERE p.client_id = c.id AND p.status = 'active'
      )
  LOOP
    INSERT INTO public.client_program_periods (client_id, program_id, started_at, status)
    VALUES (
      v_client_id,
      v_program_id,
      COALESCE((
        SELECT min(wl.date)::timestamptz
        FROM public.workout_logs wl
        WHERE wl.client_id = v_client_id
      ), now()),
      'active'
    )
    RETURNING id INTO v_period;

    UPDATE public.workout_logs
    SET program_id = v_program_id,
        program_period_id = v_period
    WHERE client_id = v_client_id;

    UPDATE public.program_schedule
    SET program_id = v_program_id,
        program_period_id = v_period
    WHERE client_id = v_client_id;
  END LOOP;
END $$;

-- 4. RLS: staff read only (mirrors workout_logs after P0); bot/web writes go
--    through service_role.
ALTER TABLE client_program_periods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON client_program_periods FROM authenticated;
REVOKE ALL ON client_program_periods FROM anon;

CREATE POLICY "Client program periods: staff read"
  ON client_program_periods FOR SELECT
  TO authenticated
  USING ((SELECT public.is_staff()));

GRANT SELECT ON client_program_periods TO authenticated;
GRANT ALL ON client_program_periods TO service_role;
