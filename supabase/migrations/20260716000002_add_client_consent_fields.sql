-- Migration: add_client_consent_fields
-- Description: Поля для хранения согласия клиента (не тренера) на обработку ПДн

ALTER TABLE clients
  ADD COLUMN client_consent_given BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN client_consent_given_at TIMESTAMPTZ,
  ADD COLUMN client_consent_ip TEXT,
  ADD COLUMN client_consent_user_agent TEXT,
  ADD COLUMN client_consent_version TEXT;

COMMENT ON COLUMN clients.client_consent_given IS 'Клиент лично дал согласие на обработку ПДн через клиентский портал';
COMMENT ON COLUMN clients.client_consent_given_at IS 'Дата и время принятия согласия клиентом';
COMMENT ON COLUMN clients.client_consent_ip IS 'IP-адрес клиента при принятии согласия';
COMMENT ON COLUMN clients.client_consent_user_agent IS 'User-Agent браузера клиента при принятии согласия';
COMMENT ON COLUMN clients.client_consent_version IS 'Версия политики конфиденциальности, которую принял клиент';
