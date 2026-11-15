-- Migration: program period switching (Phase 30.5) + 30.4 review leftovers.
-- start_program_period is the single atomic entry point for (re)assigning a
-- program to a client: close the old period, archive (never delete) the old
-- schedule, close pauses, stamp pre-period logs, create the new period and
-- its schedule. Old logs and schedule rows are kept for history.

-- 1. 30.4 leftovers: period integrity constraints.
ALTER TABLE client_program_periods
  ADD CONSTRAINT client_program_periods_active_no_end
    CHECK ((status = 'active') = (ended_at IS NULL)),
  ADD CONSTRAINT client_program_periods_period_order
    CHECK (ended_at IS NULL OR ended_at > started_at);

CREATE INDEX IF NOT EXISTS idx_workout_logs_program_id
  ON workout_logs (program_id);
CREATE INDEX IF NOT EXISTS idx_program_schedule_program_id
  ON program_schedule (program_id);
CREATE INDEX IF NOT EXISTS idx_client_program_periods_program_id
  ON client_program_periods (program_id);

-- 2. Atomic program (re)assignment. Returns the new period id.
--    p_schedule: rows shaped like program_schedule inserts minus
--    client_id/program_id/program_period_id/id/created_at/updated_at.
--    Errors loudly on unknown client, inactive program or garbage rows.
CREATE OR REPLACE FUNCTION public.start_program_period(
  p_client_id uuid,
  p_program_id uuid,
  p_schedule jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_period_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.clients c WHERE c.id = p_client_id
  ) THEN
    RAISE EXCEPTION 'CLIENT_NOT_FOUND: %', p_client_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.programs g
    WHERE g.id = p_program_id AND g.active = true
  ) THEN
    RAISE EXCEPTION 'PROGRAM_NOT_FOUND: %', p_program_id;
  END IF;

  -- Logs written before periods existed (or by legacy code paths) belong to
  -- the closing period, not to the new one: keep per-period history clean.
  UPDATE public.workout_logs wl
  SET program_period_id = p.id,
      program_id = COALESCE(wl.program_id, p.program_id)
  FROM public.client_program_periods p
  WHERE p.client_id = p_client_id
    AND p.status = 'active'
    AND wl.client_id = p_client_id
    AND wl.program_period_id IS NULL;

  UPDATE public.client_program_periods
  SET status = 'completed',
      ended_at = now(),
      updated_at = now()
  WHERE client_id = p_client_id
    AND status = 'active';

  UPDATE public.program_schedule
  SET status = 'archived',
      updated_at = now()
  WHERE client_id = p_client_id
    AND status IS DISTINCT FROM 'archived';

  UPDATE public.plan_pauses
  SET status = 'completed',
      pause_end = COALESCE(pause_end, CURRENT_DATE),
      updated_at = now()
  WHERE client_id = p_client_id
    AND status = 'active';

  UPDATE public.clients
  SET program_id = p_program_id,
      updated_at = now()
  WHERE id = p_client_id;

  INSERT INTO public.client_program_periods (client_id, program_id)
  VALUES (p_client_id, p_program_id)
  RETURNING id INTO v_new_period_id;

  INSERT INTO public.program_schedule (
    client_id, program_id, program_period_id, week_number, sheet_name,
    is_deload, start_date, end_date, original_start_date, original_end_date,
    focus, status, training_days
  )
  SELECT
    p_client_id, p_program_id, v_new_period_id, r.week_number, r.sheet_name,
    COALESCE(r.is_deload, false), r.start_date, r.end_date,
    r.original_start_date, r.original_end_date, r.focus,
    COALESCE(r.status, 'pending'), r.training_days
  FROM jsonb_to_recordset(p_schedule)
    AS r (
      week_number int,
      sheet_name text,
      is_deload boolean,
      start_date date,
      end_date date,
      original_start_date date,
      original_end_date date,
      focus text,
      status text,
      training_days int[]
    );

  RETURN v_new_period_id;
END $$;

REVOKE ALL ON FUNCTION public.start_program_period(uuid, uuid, jsonb)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.start_program_period(uuid, uuid, jsonb)
  TO service_role;
