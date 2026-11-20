UPDATE public.purchase_requests
SET name = CASE
  WHEN name ~ '^@[A-Za-z0-9_]{4,32}$' THEN lower(name)
  WHEN name ~ '^Клиент #[A-Z0-9]{6}$' THEN name
  WHEN client_id IS NOT NULL
    THEN 'Клиент #' || upper(right(replace(client_id::text, '-', ''), 6))
  WHEN telegram_id IS NOT NULL
    THEN 'Клиент #' || upper(lpad(right(telegram_id::text, 6), 6, '0'))
  ELSE 'Клиент #' || upper(right(replace(id::text, '-', ''), 6))
END
WHERE name IS NULL
  OR NOT (
    name ~ '^@[A-Za-z0-9_]{4,32}$'
    OR name ~ '^Клиент #[A-Z0-9]{6}$'
  );

UPDATE public.clients
SET name = CASE
  WHEN name ~ '^@[A-Za-z0-9_]{4,32}$' THEN lower(name)
  WHEN name ~ '^Клиент #[A-Z0-9]{6}$' THEN name
  ELSE 'Клиент #' || upper(right(replace(id::text, '-', ''), 6))
END
WHERE name IS NULL
  OR NOT (
    name ~ '^@[A-Za-z0-9_]{4,32}$'
    OR name ~ '^Клиент #[A-Z0-9]{6}$'
  );

ALTER TABLE public.purchase_requests
  DROP COLUMN IF EXISTS contact,
  DROP COLUMN IF EXISTS first_name,
  DROP COLUMN IF EXISTS last_name;

-- delete_client_cascade cleans purchase_requests identifiers; rebuild it after
-- the columns are gone so late webhooks cannot reactivate a deleted client.
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

  UPDATE public.purchase_requests
     SET name = 'Клиент #' || upper(right(replace(p_client_id::text, '-', ''), 6)),
         telegram_id = NULL,
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

COMMENT ON COLUMN public.purchase_requests.name IS 'Telegram username as @username or stable fallback Client #XXXXXX; no free-form names';
COMMENT ON COLUMN public.clients.name IS 'Telegram username as @username or stable fallback Client #XXXXXX; no free-form names';
