-- P0 follow-up: never auto-provision staff, revoke stale tokens, make client
-- deletion cover linked programs and bot state, serialize token issuance,
-- and reduce authenticated access to read-only staff data.

-- 1. New auth users are clients, never staff. Staff profiles are created
-- explicitly by an operator after the fact.
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
    COALESCE(
      NULLIF(NEW.raw_user_meta_data ->> 'name', ''),
      NULLIF(split_part(COALESCE(NEW.email, NEW.phone, ''), '@', 1), ''),
      NEW.id::text
    ),
    'client'
  );
  RETURN NEW;
END;
$$;

ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'client';
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'coach', 'client'));

-- 2. Keep profiles readable by their owner and staff; only service_role writes.
DROP POLICY IF EXISTS "Profiles: staff read" ON public.profiles;
DROP POLICY IF EXISTS "Profiles: own update" ON public.profiles;
DROP POLICY IF EXISTS "Profiles: own read" ON public.profiles;
DROP POLICY IF EXISTS "Profiles: own or staff read" ON public.profiles;

CREATE POLICY "Profiles: own or staff read"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR (SELECT public.is_staff()));

REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM authenticated;

-- 3. Business tables are staff-readable only. Mutations go through service_role
-- server code, so an authenticated JWT cannot delete or rewrite client data.
DROP POLICY IF EXISTS "Exercises: staff read" ON public.exercises;
DROP POLICY IF EXISTS "Purchase requests: staff read" ON public.purchase_requests;
DROP POLICY IF EXISTS "Exercises: staff access" ON public.exercises;
DROP POLICY IF EXISTS "Purchase requests: staff access" ON public.purchase_requests;

DO $$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT * FROM (VALUES
      ('clients'),
      ('workout_logs'),
      ('measurements'),
      ('checkins'),
      ('photos'),
      ('program_schedule'),
      ('messages'),
      ('notification_log'),
      ('programs'),
      ('plan_pauses'),
      ('client_exercise_swaps'),
      ('exercises'),
      ('purchase_requests')
    ) AS tables(table_name)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || ': staff access', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || ': staff read', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.is_staff()))',
      table_name || ': staff read',
      table_name
    );
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', table_name);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', table_name);
  END LOOP;
END $$;

REVOKE ALL ON public.client_tokens FROM anon, authenticated;

-- 4. A client token row belongs exclusively to service_role code.
DROP POLICY IF EXISTS "Client tokens: service only" ON public.client_tokens;
ALTER TABLE public.client_tokens ENABLE ROW LEVEL SECURITY;

-- 5. Delete programs owned by this client (programs.client_id). Legacy
-- cross-assigned references are invalid; clearing them prevents the owner's
-- personal content from surviving deletion on another client's card.
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

  UPDATE public.clients
     SET purchased_program_id = NULL
   WHERE purchased_program_id = ANY(COALESCE(v_program_ids, ARRAY[]::uuid[]));

  DELETE FROM public.programs p
  WHERE p.id = ANY(COALESCE(v_program_ids, ARRAY[]::uuid[]));
END;
$$;

REVOKE ALL ON FUNCTION public.delete_client_cascade(uuid, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_client_cascade(uuid, bigint) TO service_role;

-- 6. Token issuance is serialized per client and always revokes the old token.
CREATE OR REPLACE FUNCTION public.create_client_token(
  p_client_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF length(p_token_hash) <> 64 THEN
    RAISE EXCEPTION 'invalid token hash';
  END IF;

  PERFORM 1
  FROM public.clients
  WHERE id = p_client_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'client not found';
  END IF;

  UPDATE public.client_tokens
     SET revoked_at = now()
   WHERE client_id = p_client_id
     AND revoked_at IS NULL;

  INSERT INTO public.client_tokens (client_id, token_hash, expires_at, last_used_at)
  VALUES (p_client_id, p_token_hash, p_expires_at, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.create_client_token(uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_client_token(uuid, text, timestamptz) TO service_role;

-- 7. Backfill compatibility: old web/bot builds insert only plaintext token.
CREATE OR REPLACE FUNCTION public.fill_client_token_hash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.token_hash IS NULL AND NEW.token IS NOT NULL THEN
    NEW.token_hash := encode(sha256(convert_to(NEW.token, 'UTF8')), 'hex');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fill_client_token_hash ON public.client_tokens;
CREATE TRIGGER fill_client_token_hash
  BEFORE INSERT ON public.client_tokens
  FOR EACH ROW EXECUTE FUNCTION public.fill_client_token_hash();

-- 8. One active token per client. Retire duplicates before adding the index.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY client_id
           ORDER BY expires_at DESC, created_at DESC
         ) AS rn
  FROM public.client_tokens
  WHERE revoked_at IS NULL
)
UPDATE public.client_tokens t
   SET revoked_at = now()
  FROM ranked r
 WHERE t.id = r.id
   AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS client_tokens_one_active_per_client
  ON public.client_tokens (client_id)
  WHERE revoked_at IS NULL;

-- 9. Revoke tokens when a client loses active access; a fresh link is issued
-- after reactivation.
CREATE OR REPLACE FUNCTION public.revoke_client_tokens_on_inactive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'active' AND OLD.status = 'active' THEN
    UPDATE public.client_tokens
       SET revoked_at = now()
     WHERE client_id = NEW.id
       AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS revoke_client_tokens_on_inactive ON public.clients;
CREATE TRIGGER revoke_client_tokens_on_inactive
  AFTER UPDATE OF status ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.revoke_client_tokens_on_inactive();

-- 10. Tighten token hash validation for future rows.
ALTER TABLE public.client_tokens DROP CONSTRAINT IF EXISTS client_tokens_token_hash_format;
ALTER TABLE public.client_tokens
  ADD CONSTRAINT client_tokens_token_hash_format
  CHECK (token_hash ~ '^[0-9a-f]{64}$') NOT VALID;
ALTER TABLE public.client_tokens VALIDATE CONSTRAINT client_tokens_token_hash_format;
