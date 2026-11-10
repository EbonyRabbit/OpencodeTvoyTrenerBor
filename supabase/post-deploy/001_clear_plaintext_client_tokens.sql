-- Run manually AFTER the web/bot release that reads client_tokens.token_hash
-- is live. Pre-hash builds validate the plaintext token and will stop working
-- once this runs.
UPDATE public.client_tokens
   SET token = NULL
 WHERE token_hash IS NOT NULL
   AND token IS NOT NULL;
