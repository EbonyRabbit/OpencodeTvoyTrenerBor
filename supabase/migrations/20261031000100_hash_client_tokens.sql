-- Store only a SHA-256 hash of client portal tokens.
-- Plaintext tokens are returned once at generation time and never persisted.

ALTER TABLE client_tokens ADD COLUMN IF NOT EXISTS token_hash TEXT;
ALTER TABLE client_tokens ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

UPDATE client_tokens
SET token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex')
WHERE token_hash IS NULL;

-- Keep pre-hash builds working during a rolling deploy: they insert only the
-- plaintext token, and this trigger derives token_hash before NOT NULL applies.
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

DROP TRIGGER IF EXISTS fill_client_token_hash ON client_tokens;
CREATE TRIGGER fill_client_token_hash
  BEFORE INSERT ON client_tokens
  FOR EACH ROW EXECUTE FUNCTION public.fill_client_token_hash();

ALTER TABLE client_tokens ALTER COLUMN token_hash SET NOT NULL;
ALTER TABLE client_tokens ALTER COLUMN token DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS client_tokens_token_hash_key
  ON client_tokens(token_hash);

CREATE INDEX IF NOT EXISTS idx_client_tokens_active
  ON client_tokens(client_id, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE client_tokens
  ADD CONSTRAINT client_tokens_token_hash_len CHECK (length(token_hash) = 64) NOT VALID;

ALTER TABLE client_tokens VALIDATE CONSTRAINT client_tokens_token_hash_len;

COMMENT ON COLUMN client_tokens.token IS 'Legacy plaintext token; NULL for tokens created after hashing migration';
COMMENT ON COLUMN client_tokens.token_hash IS 'SHA-256 hex hash of the magic-link token';
COMMENT ON COLUMN client_tokens.revoked_at IS 'Token revocation timestamp; NULL means active';
