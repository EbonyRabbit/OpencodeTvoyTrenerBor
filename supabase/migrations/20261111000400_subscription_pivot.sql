-- Migration: subscription model pivot (Phase 30.7) + 30.6 review leftovers.
-- 1) Drop clients.purchased_program_id: under the subscription model one live
--    subscription opens all programs, so there is no "purchased program"
--    anymore. Existing values are trivially recoverable (for every client the
--    purchased program equals the current program_id).
-- 2) close_active_period: DB-side period close for client offboarding —
--    ended_at is computed from the database clock, not the app server clock
--    (tail 30.6-2: a lagging JS clock could violate
--    client_program_periods_period_order, leaving a benign zombie period).
-- 3) apply_program_rollback: the "rollback" resume strategy as a single
--    atomic SQL transaction (tail 30.6-1): ensureOriginalDates, archive of
--    the repeated week, REPEAT insert and future-weeks shift either all
--    happen or none do. The pause completion is part of the same
--    transaction; the JS side keeps the claim CAS (active → resuming) and
--    reverts the claim on RPC error.

-- 1. purchased_program_id removal (drop the partial index first is not
--    needed: DROP COLUMN cascades to dependent indexes).
ALTER TABLE public.clients DROP COLUMN IF EXISTS purchased_program_id;

-- delete_client_cascade referenced clients.purchased_program_id; rebuild it
-- without the cleared-reference UPDATE, which is meaningless once the column
-- is gone. Body otherwise identical to 20261031000200_p0_followup.sql.
CREATE OR REPLACE FUNCTION public.delete_client_cascade(
  p_client_id uuid,
  p_telegram_id bigint DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_program_ids uuid[];
BEGIN
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
    INTO v_program_ids
    FROM public.programs
   WHERE client_id = p_client_id;

  -- Keep a payment audit trail but remove all client identifiers. A deleted
  -- client must not reactivate from a late webhook.
  UPDATE public.purchase_requests
     SET name = 'Удалённый клиент',
         contact = '—',
         telegram_id = NULL,
         first_name = NULL,
         last_name = NULL,
         client_id = NULL,
         consent_given = false,
         consent_at = NULL,
         consent_version = NULL,
         status = CASE WHEN status = 'pending' THEN 'cancelled' ELSE status END
   WHERE client_id = p_client_id
      OR (p_telegram_id IS NOT NULL AND telegram_id = p_telegram_id);

  DELETE FROM public.bot_logs
  WHERE client_id = p_client_id
     OR (p_telegram_id IS NOT NULL AND telegram_id = p_telegram_id);

  DELETE FROM public.bot_state
  WHERE client_id = p_client_id
     OR (p_telegram_id IS NOT NULL AND telegram_id = p_telegram_id);

  DELETE FROM public.bot_dedup
  WHERE key LIKE '%' || p_client_id::text || '%'
     OR (
       p_telegram_id IS NOT NULL
       AND key LIKE '%:' || p_telegram_id::text || ':%'
     );

  DELETE FROM public.clients
  WHERE id = p_client_id;

  DELETE FROM public.programs p
  WHERE p.id = ANY(COALESCE(v_program_ids, ARRAY[]::uuid[]));
END;
$$;

REVOKE ALL ON FUNCTION public.delete_client_cascade(uuid, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_client_cascade(uuid, bigint) TO service_role;

-- 2. Atomic period close for offboarding (tails 30.6-2).
CREATE OR REPLACE FUNCTION public.close_active_period(p_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.client_program_periods
  SET status = 'completed',
      ended_at = GREATEST(now(), started_at + interval '1 microsecond'),
      updated_at = now()
  WHERE client_id = p_client_id
    AND status = 'active';
END $$;

REVOKE ALL ON FUNCTION public.close_active_period(uuid)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.close_active_period(uuid)
  TO service_role;

-- 3. Atomic rollback resume strategy (tail 30.6-1).
-- Mirrors the JS sequence in plan-adjustment.ts applyRollback: original-date
-- backfill, archive of the repeated week, REPEAT week insert, future-weeks
-- shift, pause completion. Differences by design: ties on the rollback week
-- are resolved deterministically (latest created_at) instead of failing, and
-- the pause completion lives inside the same transaction.
CREATE OR REPLACE FUNCTION public.apply_program_rollback(
  p_client_id uuid,
  p_pause_id uuid,
  p_resume_date date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pause_start date;
  v_period_id uuid;
  v_period_program_id uuid;
  v_rollback_week int;
  v_week_id uuid;
  v_week_sheet_name text;
  v_week_focus text;
  v_original_start date;
  v_original_end date;
  v_duration int;
  v_shift_days int;
  v_future_ids uuid[];
  v_future_start date[];
  v_future_end date[];
BEGIN
  -- The pause must be claimed (status='resuming') by the caller before the
  -- RPC runs; this mirrors the JS claimPause CAS.
  SELECT pp.pause_start INTO v_pause_start
  FROM public.plan_pauses pp
  WHERE pp.id = p_pause_id
    AND pp.client_id = p_client_id
    AND pp.status = 'resuming';
  IF v_pause_start IS NULL THEN
    RAISE EXCEPTION 'PAUSE_NOT_CLAIMED: %', p_pause_id;
  END IF;

  SELECT p.id, p.program_id INTO v_period_id, v_period_program_id
  FROM public.client_program_periods p
  WHERE p.client_id = p_client_id AND p.status = 'active'
  LIMIT 1;

  IF v_period_id IS NULL THEN
    -- No active program period: nothing to roll back on the schedule, the
    -- pause still completes (previous JS behavior: applyRollback returned
    -- {} and resumePlan completed the pause).
    UPDATE public.plan_pauses
    SET pause_end = p_resume_date,
        strategy = 'rollback',
        status = 'completed',
        updated_at = now()
    WHERE id = p_pause_id AND status = 'resuming';
    RETURN;
  END IF;

  -- ensureOriginalDates: backfill original dates for shifted/repeated weeks.
  UPDATE public.program_schedule s
  SET original_start_date = s.start_date,
      original_end_date = s.end_date,
      updated_at = now()
  WHERE s.client_id = p_client_id
    AND s.program_period_id = v_period_id
    AND s.original_start_date IS NULL;

  SELECT COALESCE(wl.week, 1) INTO v_rollback_week
  FROM public.workout_logs wl
  WHERE wl.client_id = p_client_id
    AND wl.program_period_id = v_period_id
  ORDER BY wl.date DESC
  LIMIT 1;
  v_rollback_week := COALESCE(v_rollback_week, 1);

  SELECT s.id, s.sheet_name, s.focus,
         COALESCE(s.original_start_date, s.start_date, p_resume_date),
         COALESCE(s.original_end_date, s.end_date, p_resume_date)
  INTO v_week_id, v_week_sheet_name, v_week_focus, v_original_start, v_original_end
  FROM public.program_schedule s
  WHERE s.client_id = p_client_id
    AND s.program_period_id = v_period_id
    AND s.week_number = v_rollback_week
    AND s.status IS DISTINCT FROM 'archived'
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF v_week_id IS NULL THEN
    -- No live week to repeat: keep the previous behavior of completing the
    -- pause without schedule changes.
    UPDATE public.plan_pauses
    SET pause_end = p_resume_date,
        strategy = 'rollback',
        status = 'completed',
        updated_at = now()
    WHERE id = p_pause_id AND status = 'resuming';
    RETURN;
  END IF;

  v_duration := (v_original_end - v_original_start) + 1;

  -- Archive the original week BEFORE capturing future weeks, so the freshly
  -- archived row is never shifted (same reason as in the JS version).
  UPDATE public.program_schedule
  SET status = 'archived',
      updated_at = now()
  WHERE client_id = p_client_id
    AND program_period_id = v_period_id
    AND week_number = v_rollback_week
    AND status IS DISTINCT FROM 'archived';

  -- Capture future weeks BEFORE inserting the REPEAT week, so the insert
  -- itself is never shifted.
  SELECT array_agg(f.id ORDER BY f.week_number),
         array_agg(f.start_date ORDER BY f.week_number),
         array_agg(f.end_date ORDER BY f.week_number)
  INTO v_future_ids, v_future_start, v_future_end
  FROM public.program_schedule f
  WHERE f.client_id = p_client_id
    AND f.program_period_id = v_period_id
    AND f.status IS DISTINCT FROM 'archived'
    AND f.start_date >= v_pause_start;

  INSERT INTO public.program_schedule (
    client_id, program_id, program_period_id, week_number, sheet_name,
    is_deload, focus, start_date, end_date, original_start_date,
    original_end_date, status
  )
  VALUES (
    p_client_id, v_period_program_id, v_period_id, v_rollback_week,
    CASE WHEN v_week_sheet_name IS NOT NULL THEN v_week_sheet_name || '_REPEAT' END,
    false,
    CASE WHEN v_week_focus IS NOT NULL THEN v_week_focus || ' (повтор)' ELSE 'Повтор' END,
    p_resume_date, p_resume_date + (v_duration - 1),
    v_original_start, v_original_end, 'active'
  );

  -- daysBetween(pause_start, resume_date) + week duration.
  v_shift_days := (p_resume_date - v_pause_start) + v_duration;

  UPDATE public.program_schedule s
  SET start_date = t.sd + v_shift_days,
      end_date = t.ed + v_shift_days,
      updated_at = now()
  FROM unnest(v_future_ids, v_future_start, v_future_end) AS t(id, sd, ed)
  WHERE s.id = t.id
    AND t.sd IS NOT NULL
    AND t.ed IS NOT NULL;

  UPDATE public.plan_pauses
  SET pause_end = p_resume_date,
      strategy = 'rollback',
      status = 'completed',
      updated_at = now()
  WHERE id = p_pause_id
    AND client_id = p_client_id
    AND status = 'resuming';
END $$;

REVOKE ALL ON FUNCTION public.apply_program_rollback(uuid, uuid, date)
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.apply_program_rollback(uuid, uuid, date)
  TO service_role;
