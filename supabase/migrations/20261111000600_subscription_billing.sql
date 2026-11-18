-- Migration: 30.9 subscription billing idempotency.
-- Renewal webhooks reuse the original order_num (our payment row id), so a
-- distinct physical charge needs its own idempotency guard. One paid period
-- per subscription is the invariant: a replayed webhook computes the same
-- period_start and is rejected by this unique index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_payments_period
  ON subscription_payments (subscription_id, period_start)
  WHERE period_start IS NOT NULL;

COMMENT ON INDEX idx_subscription_payments_period IS
  'One charge per subscription per period; renewal webhook replays are idempotent';

-- A payment row can be captured before all side effects (subscription, client,
-- notification) are applied. applied_at marks the point after which a webhook
-- replay must be a no-op; a NULL applied_at is safe to replay idempotently.
ALTER TABLE subscription_payments
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;

COMMENT ON COLUMN subscription_payments.applied_at IS
  'All subscription/client side effects for this charge were applied; NULL means a webhook retry must finish them';

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_pending_client
  ON subscriptions (client_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_payments_pending_sub
  ON subscription_payments (subscription_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_log_expiry_period
  ON notification_log (
    client_id,
    (metadata->>'subscription_id'),
    (metadata->>'period_end')
  )
  WHERE type = 'subscription_expiring';
