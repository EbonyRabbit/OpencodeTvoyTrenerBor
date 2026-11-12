-- Migration: subscription tables (Phase 30.3)
-- Subscription opens all programs for a client. One live subscription per
-- client; every period is 30 days, auto-renewed by Prodamus. The bot still
-- tracks workouts per program_period (Phase 30.4), not per subscription.

-- access_end_date ownership (Phase 30 decision, recorded here on purpose):
-- While a client has a live subscription (active/past_due), subscriptions are
-- the single source of truth for clients.access_end_date: purchase/manual
-- paths that also write the column are overwritten by the sync trigger below
-- (the panel will revoke access by cancelling the subscription in Phase 30.8).
-- When no live subscription remains, the trigger never writes NULL: the bot
-- gate treats NULL as unlimited access, so the last known period end stays in
-- the column and the lazy expiry gate cuts access exactly when it passes.

-- 1. Plans: what the coach sells. A row is immutable in code; coach edits
--    price/title in the panel later (Phase 30.1 fixes the real price).
CREATE TABLE subscription_plans (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  price        NUMERIC(10, 2) NOT NULL CHECK (price > 0),
  period_days  INT NOT NULL DEFAULT 30 CHECK (period_days > 0),
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE subscription_plans IS 'Subscription plans: code/title/price/period. Prodamus auto-charge period is period_days (30)';
COMMENT ON COLUMN subscription_plans.code IS 'Stable plan key (e.g. monthly); used by code and webhooks, never renamed';
COMMENT ON COLUMN subscription_plans.price IS 'Charge amount in RUB per period';

CREATE TRIGGER set_updated_at_subscription_plans
  BEFORE UPDATE ON subscription_plans
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Default plan; the coach adjusts price in the panel (Phase 30.1).
INSERT INTO subscription_plans (code, title, price, period_days)
VALUES ('monthly', 'Подписка на все программы', 4900.00, 30)
ON CONFLICT (code) DO NOTHING;

-- 2. Subscriptions: one per client, active until cancelled or expired.
CREATE TABLE subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  plan_id                  UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  provider                 TEXT NOT NULL DEFAULT 'prodamus' CHECK (provider IN ('prodamus')),
  provider_subscription_id TEXT UNIQUE,
  status                   TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'past_due', 'cancelled', 'expired')),
  current_period_start     TIMESTAMPTZ,
  current_period_end       TIMESTAMPTZ,
  cancel_at_period_end     BOOLEAN NOT NULL DEFAULT false,
  next_payment_at          TIMESTAMPTZ,
  paid_at                  TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_period_order
    CHECK (current_period_end IS NULL OR current_period_end > current_period_start),
  CONSTRAINT subscriptions_live_needs_period
    CHECK (status NOT IN ('active', 'past_due') OR current_period_end IS NOT NULL)
);

-- A client has at most one live subscription (grace counts as live).
CREATE UNIQUE INDEX idx_subscriptions_one_live
  ON subscriptions (client_id)
  WHERE status IN ('active', 'past_due');

COMMENT ON TABLE subscriptions IS 'Client subscriptions: pending → active/past_due → cancelled/expired; auto-renew via Prodamus';
COMMENT ON COLUMN subscriptions.provider_subscription_id IS 'Subscription id at the provider (Prodamus), unique when present';
COMMENT ON COLUMN subscriptions.current_period_start IS 'Start of the current paid period';
COMMENT ON COLUMN subscriptions.current_period_end IS 'End of the current paid period; access expires after this unless renewed';
COMMENT ON COLUMN subscriptions.cancel_at_period_end IS 'True after client requested cancellation: period still active until current_period_end';
COMMENT ON COLUMN subscriptions.next_payment_at IS 'Planned next auto-charge time (renewal scheduler input)';
COMMENT ON COLUMN subscriptions.paid_at IS 'Last successful payment time';

CREATE INDEX idx_subscriptions_client_id ON subscriptions(client_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_next_payment
  ON subscriptions(next_payment_at)
  WHERE status IN ('active', 'past_due') AND next_payment_at IS NOT NULL;

CREATE TRIGGER set_updated_at_subscriptions
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- 3. Payments: full audit of every charge (first payment + renewals).
CREATE TABLE subscription_payments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id      UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  provider_payment_id  TEXT UNIQUE,
  order_id             TEXT UNIQUE,
  amount               NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  status               TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'success', 'failed', 'cancelled', 'refunded')),
  paid_at              TIMESTAMPTZ,
  period_start         TIMESTAMPTZ,
  period_end           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT subscription_payments_period_order
    CHECK (period_end IS NULL OR period_end > period_start)
);

COMMENT ON TABLE subscription_payments IS 'Subscription charges: first payment and renewals; status mirrors Prodamus webhook events';
COMMENT ON COLUMN subscription_payments.provider_payment_id IS 'Payment id at the provider (Prodamus), unique when present';
COMMENT ON COLUMN subscription_payments.order_id IS 'Prodamus order id of this charge, unique; webhook matches on it';
COMMENT ON COLUMN subscription_payments.period_start IS 'Paid period start (NULL until payment succeeds)';
COMMENT ON COLUMN subscription_payments.period_end IS 'Paid period end (NULL until payment succeeds)';

CREATE INDEX idx_subscription_payments_subscription_id ON subscription_payments(subscription_id);
CREATE INDEX idx_subscription_payments_status ON subscription_payments(status);

CREATE TRIGGER set_updated_at_subscription_payments
  BEFORE UPDATE ON subscription_payments
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- 4. RLS: staff read only, writes via service_role (server code), anon locked.
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON subscription_plans, subscriptions, subscription_payments FROM authenticated;
REVOKE ALL ON subscription_plans, subscriptions, subscription_payments FROM anon;

CREATE POLICY "Subscription plans: staff read"
  ON subscription_plans FOR SELECT
  TO authenticated
  USING ((SELECT public.is_staff()));

CREATE POLICY "Subscriptions: staff read"
  ON subscriptions FOR SELECT
  TO authenticated
  USING ((SELECT public.is_staff()));

CREATE POLICY "Subscription payments: staff read"
  ON subscription_payments FOR SELECT
  TO authenticated
  USING ((SELECT public.is_staff()));

GRANT SELECT ON subscription_plans, subscriptions, subscription_payments TO authenticated;
GRANT ALL ON subscription_plans, subscriptions, subscription_payments TO service_role;

-- 5. Keep clients.access_end_date in sync with the live subscription.
--    Active/past_due extends access until the furthest live period end.
--    Cancelled/expired/pending rows never count, and NULL is never written
--    (the bot gate treats NULL as unlimited access) — the last known period
--    end stays and the lazy expiry gate expires it naturally.
CREATE OR REPLACE FUNCTION public.sync_client_access_end_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_client uuid;
  v_end    timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_client := OLD.client_id;
  ELSE
    v_client := NEW.client_id;
  END IF;

  SELECT max(current_period_end) INTO v_end
  FROM public.subscriptions
  WHERE client_id = v_client
    AND status IN ('active', 'past_due');

  IF v_end IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  UPDATE public.clients
  SET access_end_date = v_end
  WHERE id = v_client
    AND access_end_date IS DISTINCT FROM v_end;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_client_access_end_date() FROM PUBLIC;

CREATE TRIGGER sync_client_access_end_date
  AFTER INSERT OR UPDATE OR DELETE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.sync_client_access_end_date();
