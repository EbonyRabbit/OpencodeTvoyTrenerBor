-- Migration: add_consent_field
-- Description: Добавить поле согласия на обработку персональных данных

ALTER TABLE clients
  ADD COLUMN consent_given BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN consent_given_at TIMESTAMPTZ;

-- Комментарии
COMMENT ON COLUMN clients.consent_given IS 'Клиент дал согласие на обработку персональных данных (152-ФЗ)';
COMMENT ON COLUMN clients.consent_given_at IS 'Дата и время получения согласия';
