DELETE FROM public.measurements;
DELETE FROM public.checkins;
DELETE FROM public.photos;
DELETE FROM public.messages;

DELETE FROM public.purchase_requests
WHERE created_at < '2026-11-18T00:00:00Z'::timestamptz;

DELETE FROM public.bot_logs
WHERE created_at < '2026-11-18T00:00:00Z'::timestamptz
  AND (
    action NOT IN ('welcome_sent', 'welcome_followup1', 'welcome_followup2', 'policy_notice')
    OR created_at < now() - interval '8 days'
  );

DELETE FROM public.client_tokens
WHERE revoked_at IS NOT NULL
   OR expires_at < now();
