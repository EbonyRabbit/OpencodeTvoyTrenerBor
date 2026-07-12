-- Migration: create_client_tokens
-- Description: Токены для клиентского веб-портала (magic-link аутентификация)
-- Клиент получает ссылку /client/[token] и получает доступ к своим данным.

CREATE TABLE client_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE CHECK (length(token) >= 6),
  expires_at    TIMESTAMPTZ NOT NULL,
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_client_tokens
  BEFORE UPDATE ON client_tokens
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Индексы
CREATE INDEX idx_client_tokens_client_id ON client_tokens(client_id);
CREATE INDEX idx_client_tokens_expires ON client_tokens(expires_at);

-- RLS — только service_role (токен валидируется сервер-side в middleware)
ALTER TABLE client_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Client tokens: service_role full access"
  ON client_tokens FOR ALL
  TO service_role
  USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON client_tokens TO service_role;

-- Комментарии
COMMENT ON COLUMN client_tokens.token IS 'Magic-link токен (минимум 6 символов, уникальный)';
COMMENT ON COLUMN client_tokens.expires_at IS 'Дата истечения токена';
COMMENT ON COLUMN client_tokens.last_used_at IS 'Последнее использование токена (для аудита)';

-- Очистка истёкших токенов (периодическая):
-- DELETE FROM client_tokens WHERE expires_at < now();
