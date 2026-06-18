-- Migration: create_profiles_table
-- Description: Create profiles table for auth users (admins/coaches)

CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'coach' CHECK (role IN ('admin', 'coach')),
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_profiles
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles: authenticated users can read"
  ON profiles FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Profiles: users can update own"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Profiles: insert via trigger only"
  ON profiles FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- RLS for business tables (all authenticated users = coaches for MVP)

CREATE POLICY "Clients: all access for authenticated"
  ON clients FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Workout logs: all access for authenticated"
  ON workout_logs FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Measurements: all access for authenticated"
  ON measurements FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Checkins: all access for authenticated"
  ON checkins FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Photos: all access for authenticated"
  ON photos FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Program schedule: all access for authenticated"
  ON program_schedule FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Exercises: all access for authenticated"
  ON exercises FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Messages: all access for authenticated"
  ON messages FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Notification log: all access for authenticated"
  ON notification_log FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Programs: all access for authenticated"
  ON programs FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Add FK from messages.coach_id to profiles
ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_coach_id_fkey,
  ADD CONSTRAINT messages_coach_id_fkey
    FOREIGN KEY (coach_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data ->> 'role', 'coach')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
