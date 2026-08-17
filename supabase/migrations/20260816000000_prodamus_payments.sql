-- Migration: prodamus_payments
-- Description: Таблица заявок на покупку программ и индивидуальное ведение
-- (Фаза 21, Продамус). Хранит заявку до/после оплаты, согласие на обработку
-- данных (до оплаты), связь с заказом Продамуса (order_id) и статус оплаты.
-- Содержит ПДн (имя, контакт, Telegram ID, согласие): запись — только через
-- service_role (бот, вебхук Продамуса, server actions), чтение — панель
-- тренера (authenticated c ролью admin/coach).

-- 1. Таблица
CREATE TABLE purchase_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id      UUID REFERENCES programs(id) ON DELETE SET NULL,
  client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  contact         TEXT NOT NULL,
  telegram_id     BIGINT,
  first_name      TEXT,
  last_name       TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  order_id        TEXT UNIQUE,
  amount          NUMERIC(10, 2) CHECK (amount IS NULL OR amount > 0),
  sub_type        TEXT NOT NULL CHECK (sub_type IN ('program', 'individ')),
  consent_given   BOOLEAN NOT NULL DEFAULT false,
  consent_at      TIMESTAMPTZ,
  consent_version TEXT,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_purchase_requests
  BEFORE UPDATE ON purchase_requests
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- 2. Индексы (order_id получает индекс от UNIQUE-констрейнта)
CREATE INDEX idx_purchase_requests_status ON purchase_requests(status);
CREATE INDEX idx_purchase_requests_telegram_id ON purchase_requests(telegram_id);
CREATE INDEX idx_purchase_requests_client_id ON purchase_requests(client_id);

-- 3. RLS: чтение — только коучи/админы (authenticated с ролью из profiles),
--    запись — только service_role. Вебхук Продамуса и активация работают
--    через service_role (обходит RLS), поэтому неподписанный вебхук не сможет
--    вставить заявку через anon/authenticated.
ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;

-- Явный REVOKE DML: защита от будущих GRANT'ов, открывающих запись
-- (аналогично exercises из 20260815000000_exercise_library.sql).
REVOKE INSERT, UPDATE, DELETE ON purchase_requests FROM authenticated;

-- Таблица содержит ПДн (имя, контакт, Telegram ID, согласие) — чтение
-- ограничено ролями админа/коуча, а не всеми authenticated.
CREATE POLICY "Purchase requests: read for staff"
  ON purchase_requests
  FOR SELECT
  TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'coach')
  );

-- 4. GRANT: anon закрываем явно — дефолтные привилегии Supabase дают всем
--    ролям ALL на новые таблицы, и будущая anon-политика (напр. публичная
--    проверка статуса заказа) не должна наследовать запись.
REVOKE ALL ON purchase_requests FROM anon;
GRANT SELECT ON purchase_requests TO authenticated;
GRANT ALL ON purchase_requests TO service_role;

-- 5. Комментарии
COMMENT ON COLUMN purchase_requests.program_id IS 'Программа, на которую оформлена заявка (NULL для sub_type=individ)';
COMMENT ON COLUMN purchase_requests.client_id IS 'Клиент в clients, связанный с заявкой (заполняется при активации)';
COMMENT ON COLUMN purchase_requests.name IS 'Имя клиента (из Telegram или формы)';
COMMENT ON COLUMN purchase_requests.contact IS 'Контакт для связи: @username или телефон';
COMMENT ON COLUMN purchase_requests.telegram_id IS 'Telegram ID клиента';
COMMENT ON COLUMN purchase_requests.first_name IS 'Имя из профиля Telegram (ctx.from.first_name)';
COMMENT ON COLUMN purchase_requests.last_name IS 'Фамилия из профиля Telegram (ctx.from.last_name)';
COMMENT ON COLUMN purchase_requests.status IS 'Статус заявки: pending — создана/ожидает оплаты, paid — оплачена и активирована, cancelled — отменена/отклонена';
COMMENT ON COLUMN purchase_requests.order_id IS 'Идентификатор заказа Продамуса (UUID заявки, уникален)';
COMMENT ON COLUMN purchase_requests.amount IS 'Сумма оплаты, руб. (NUMERIC(10,2), совпадает с programs.price)';
COMMENT ON COLUMN purchase_requests.sub_type IS 'Тип заявки: program — покупка программы, individ — индивидуальное ведение/кураторство';
COMMENT ON COLUMN purchase_requests.consent_given IS 'Согласие на обработку персональных данных получено ДО оплаты (аналог clients.client_consent_given)';
COMMENT ON COLUMN purchase_requests.consent_at IS 'Время получения согласия (аналог clients.client_consent_given_at; IP/UA не записываются — согласие даётся в Telegram-контексте)';
COMMENT ON COLUMN purchase_requests.consent_version IS 'Версия политики конфиденциальности (PRIVACY_POLICY_VERSION)';
COMMENT ON COLUMN purchase_requests.paid_at IS 'Время подтверждения оплаты вебхуком Продамуса (NULL до оплаты; paid_at отличается от updated_at — его меняет любой апдейт)';