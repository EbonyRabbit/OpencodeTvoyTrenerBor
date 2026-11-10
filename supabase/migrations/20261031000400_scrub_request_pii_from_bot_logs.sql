-- Request logs must not retain name/contact. New code writes only non-PII
-- fields; this scrubs rows created by earlier builds, then removes legacy
-- dedup keys built from raw contact values.
UPDATE public.bot_logs
   SET details = (
         details::jsonb
         - 'name'
         - 'contact'
         - 'telegram_username'
       )::text
 WHERE details IS NOT NULL
   AND details LIKE '{%'
   AND pg_input_is_valid(details, 'jsonb')
   AND (
     action LIKE 'purchase_request%'
     OR action LIKE 'coach_request%'
   );

-- Contact-based dedup keys contained raw usernames/phones. Hashed keys are
-- 64 hex chars; keep those and delete only the legacy raw-contact keys.
DELETE FROM public.bot_dedup
 WHERE (
         key LIKE 'purchase:%'
         AND key !~ '^purchase:[0-9a-f-]{36}:[0-9a-f]{64}$'
       )
    OR (
         key LIKE 'individ:%'
         AND key !~ '^individ:[0-9a-f]{64}$'
       );
