-- Migration: grant_table_permissions
-- Description: Grant base table permissions to authenticated and service_role roles
-- Required because Supabase local dev with raw SQL needs explicit GRANT statements

-- Programs
GRANT SELECT, INSERT, UPDATE, DELETE ON programs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON programs TO service_role;

-- Clients
GRANT SELECT, INSERT, UPDATE, DELETE ON clients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON clients TO service_role;

-- Workout logs
GRANT SELECT, INSERT, UPDATE, DELETE ON workout_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON workout_logs TO service_role;

-- Measurements
GRANT SELECT, INSERT, UPDATE, DELETE ON measurements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON measurements TO service_role;

-- Checkins
GRANT SELECT, INSERT, UPDATE, DELETE ON checkins TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON checkins TO service_role;

-- Photos
GRANT SELECT, INSERT, UPDATE, DELETE ON photos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON photos TO service_role;

-- Program schedule
GRANT SELECT, INSERT, UPDATE, DELETE ON program_schedule TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON program_schedule TO service_role;

-- Exercises
GRANT SELECT, INSERT, UPDATE, DELETE ON exercises TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON exercises TO service_role;

-- Messages
GRANT SELECT, INSERT, UPDATE, DELETE ON messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON messages TO service_role;

-- Notification log
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_log TO service_role;

-- Profiles
GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO service_role;

-- Plan pauses (table created in 20260627000001_pause_system.sql)
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'plan_pauses') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON plan_pauses TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON plan_pauses TO service_role;
  END IF;
END $$;
