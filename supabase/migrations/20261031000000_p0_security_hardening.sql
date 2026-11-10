-- P0 security hardening: staff-only RLS, no public signup, no role escalation,
-- bot tables service_role-only, atomic client deletion.

-- 1. Single source of truth for staff authorization.
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'coach')
  );
$$;

REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated, service_role;

-- 2. Signup trigger must never trust client-supplied role metadata.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'name', ''), split_part(NEW.email, '@', 1)),
    'coach'
  );
  RETURN NEW;
END;
$$;

-- 3. Profiles: staff read, own update, no direct insert/delete, no role escalation.
DROP POLICY IF EXISTS "Profiles: authenticated users can read" ON profiles;
DROP POLICY IF EXISTS "Profiles: users can update own" ON profiles;
DROP POLICY IF EXISTS "Profiles: insert via trigger only" ON profiles;
DROP POLICY IF EXISTS "Profiles: staff read" ON profiles;
DROP POLICY IF EXISTS "Profiles: own update" ON profiles;

CREATE POLICY "Profiles: staff read"
  ON profiles FOR SELECT
  TO authenticated
  USING (public.is_staff() OR id = auth.uid());

CREATE POLICY "Profiles: own update"
  ON profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

REVOKE INSERT, DELETE ON profiles FROM authenticated;

CREATE OR REPLACE FUNCTION public.guard_profile_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND auth.role() IS NOT NULL
     AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'profile role change is not allowed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_role_change ON profiles;
CREATE TRIGGER guard_profile_role_change
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_role_change();

-- 4. Business data: authenticated users must be staff.
DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOR table_name, policy_name IN
    SELECT * FROM (VALUES
      ('clients', 'Clients: all access for authenticated'),
      ('workout_logs', 'Workout logs: all access for authenticated'),
      ('measurements', 'Measurements: all access for authenticated'),
      ('checkins', 'Checkins: all access for authenticated'),
      ('photos', 'Photos: all access for authenticated'),
      ('program_schedule', 'Program schedule: all access for authenticated'),
      ('messages', 'Messages: all access for authenticated'),
      ('notification_log', 'Notification log: all access for authenticated'),
      ('programs', 'Programs: all access for authenticated'),
      ('plan_pauses', 'plan_pauses_admin_all'),
      ('client_exercise_swaps', 'Full access to authenticated')
    ) AS policies(table_name, policy_name)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || ': staff access', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff())',
      table_name || ': staff access',
      table_name
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Exercises: all access for authenticated" ON exercises;
DROP POLICY IF EXISTS "Exercises: read for authenticated" ON exercises;
DROP POLICY IF EXISTS "Exercises: staff read" ON exercises;
CREATE POLICY "Exercises: staff read"
  ON exercises FOR SELECT
  TO authenticated
  USING (public.is_staff());

DROP POLICY IF EXISTS "Purchase requests: read for staff" ON purchase_requests;
DROP POLICY IF EXISTS "Purchase requests: staff read" ON purchase_requests;
CREATE POLICY "Purchase requests: staff read"
  ON purchase_requests FOR SELECT
  TO authenticated
  USING (public.is_staff());

-- 5. Bot internals are service_role-only.
DROP POLICY IF EXISTS "Full access to authenticated" ON bot_state;
DROP POLICY IF EXISTS "Full access to authenticated" ON bot_logs;
DROP POLICY IF EXISTS "Full access to authenticated" ON bot_schedule;
DROP POLICY IF EXISTS "Full access to authenticated" ON bot_dedup;

REVOKE ALL ON bot_state, bot_logs, bot_schedule, bot_dedup FROM anon, authenticated;

-- 6. No anonymous access to business data.
REVOKE ALL ON
  clients,
  workout_logs,
  measurements,
  checkins,
  photos,
  program_schedule,
  exercises,
  messages,
  notification_log,
  programs,
  plan_pauses,
  client_exercise_swaps,
  purchase_requests,
  profiles,
  client_tokens
FROM anon;

-- 7. Atomic client deletion including PII that otherwise survives ON DELETE SET NULL.
CREATE OR REPLACE FUNCTION public.delete_client_cascade(
  p_client_id uuid,
  p_telegram_id bigint DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.purchase_requests
  WHERE client_id = p_client_id
     OR (p_telegram_id IS NOT NULL AND telegram_id = p_telegram_id);

  DELETE FROM public.bot_logs
  WHERE client_id = p_client_id
     OR (p_telegram_id IS NOT NULL AND telegram_id = p_telegram_id);

  DELETE FROM public.programs
  WHERE client_id = p_client_id
    AND type = 'personal';

  DELETE FROM public.clients
  WHERE id = p_client_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_client_cascade(uuid, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_client_cascade(uuid, bigint) TO service_role;
