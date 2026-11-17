-- Phase 30.8: subscription-aware access-expiry reminders log a distinct
-- notification type so analytics can tell "program access ending" from
-- "subscription turns off at period end (cancel_at_period_end)".
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'subscription_expiring';
