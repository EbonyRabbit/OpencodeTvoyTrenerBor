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
  v_old_period_id uuid;
  v_old_program_id uuid;
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

  SELECT p.id, p.program_id
  INTO v_old_period_id, v_old_program_id
  FROM public.client_program_periods p
  WHERE p.client_id = p_client_id
    AND p.status = 'active'
  ORDER BY p.started_at DESC
  LIMIT 1;

  UPDATE public.workout_logs wl
  SET program_period_id = v_old_period_id,
      program_id = COALESCE(wl.program_id, v_old_program_id)
  WHERE wl.client_id = p_client_id
    AND wl.program_period_id IS NULL
    AND v_old_period_id IS NOT NULL;

  UPDATE public.client_program_periods
  SET status = 'completed',
      ended_at = now(),
      updated_at = now()
  WHERE client_id = p_client_id
    AND status = 'active';

  UPDATE public.program_schedule ps
  SET status = 'archived',
      program_id = COALESCE(ps.program_id, v_old_program_id),
      program_period_id = COALESCE(ps.program_period_id, v_old_period_id),
      updated_at = now()
  WHERE ps.client_id = p_client_id
    AND ps.status IS DISTINCT FROM 'archived';

  UPDATE public.plan_pauses
  SET status = 'completed',
      pause_end = COALESCE(pause_end, CURRENT_DATE),
      updated_at = now()
  WHERE client_id = p_client_id
    AND status IN ('active', 'resuming');

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

WITH matches AS (
  SELECT DISTINCT ON (ps.id)
    ps.id AS schedule_id,
    p.id AS period_id,
    p.program_id
  FROM public.program_schedule ps
  JOIN public.client_program_periods p
    ON p.client_id = ps.client_id
   AND p.status = 'completed'
  WHERE ps.status = 'archived'
    AND ps.program_period_id IS NULL
    AND ps.start_date IS NOT NULL
    AND ps.start_date >= p.started_at::date
    AND ps.start_date <= p.ended_at::date
  ORDER BY ps.id, p.started_at DESC
)
UPDATE public.program_schedule ps
SET program_period_id = m.period_id,
    program_id = COALESCE(ps.program_id, m.program_id),
    updated_at = now()
FROM matches m
WHERE ps.id = m.schedule_id
  AND ps.program_period_id IS NULL;
