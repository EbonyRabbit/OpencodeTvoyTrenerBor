-- 21.11: напоминание о скором истечении доступа (за 5 дней) пишется
-- в notification_log с новым типом.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'access_expiring';
