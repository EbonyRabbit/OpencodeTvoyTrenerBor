-- Migration: init_schema
-- Description: Initial database schema for ТвойТренерБот
-- Tables: clients, programs, workout_logs, measurements, checkins,
--         photos, program_schedule, exercises, messages, notification_log

-- ----------------------------
-- Helper: updated_at trigger
-- ----------------------------
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------
-- Enum types
-- ----------------------------
CREATE TYPE client_status AS ENUM ('active', 'inactive', 'access_expired');
CREATE TYPE payment_status AS ENUM ('pending', 'paid');
CREATE TYPE photo_type AS ENUM ('front', 'side', 'back');
CREATE TYPE message_direction AS ENUM ('to_client', 'to_coach');
CREATE TYPE notification_type AS ENUM ('morning', 'evening', 'measurement', 'checkin', 'alert', 'payment');

-- ----------------------------
-- 1. programs
-- ----------------------------
CREATE TABLE programs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  description   TEXT,
  equipment     TEXT,
  price         NUMERIC(10, 2),
  template_id   TEXT,
  active        BOOLEAN NOT NULL DEFAULT true,
  type          TEXT,
  language      TEXT NOT NULL DEFAULT 'ru',
  duration_weeks INTEGER NOT NULL DEFAULT 12,
  template_file_url TEXT,
  parsed_content   JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_programs
  BEFORE UPDATE ON programs
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ----------------------------
-- 2. clients
-- ----------------------------
CREATE TABLE clients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id       BIGINT UNIQUE,
  name              TEXT NOT NULL,
  status            client_status NOT NULL DEFAULT 'active',
  payment_status    payment_status NOT NULL DEFAULT 'pending',
  program_id        UUID REFERENCES programs(id) ON DELETE SET NULL,
  connect_code      TEXT UNIQUE,
  spreadsheet_id    TEXT,
  language          TEXT NOT NULL DEFAULT 'ru',
  timezone          TEXT DEFAULT 'UTC',
  morning_time      TIME DEFAULT '08:00',
  measurement_time  TIME DEFAULT '10:00',
  measurement_day   INTEGER DEFAULT 1,
  access_start_date TIMESTAMPTZ,
  access_end_date   TIMESTAMPTZ,
  legacy_id         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_clients
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ----------------------------
-- 3. workout_logs
-- ----------------------------
CREATE TABLE workout_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date       DATE NOT NULL,
  week       INTEGER,
  exercise   TEXT NOT NULL,
  sets       INTEGER,
  reps       TEXT,
  weight     NUMERIC(6, 2),
  rpe        NUMERIC(3, 1),
  comment    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_workout_logs
  BEFORE UPDATE ON workout_logs
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ----------------------------
-- 4. measurements
-- ----------------------------
CREATE TABLE measurements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  weight        NUMERIC(5, 1),
  waist         NUMERIC(5, 1),
  abdomen       NUMERIC(5, 1),
  chest         NUMERIC(5, 1),
  hips          NUMERIC(5, 1),
  glutes        NUMERIC(5, 1),
  left_thigh    NUMERIC(5, 1),
  right_thigh   NUMERIC(5, 1),
  left_arm      NUMERIC(5, 1),
  right_arm     NUMERIC(5, 1),
  body_fat      NUMERIC(4, 1),
  muscle_mass   NUMERIC(5, 1),
  visceral_fat  NUMERIC(3, 1),
  comment       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_measurements
  BEFORE UPDATE ON measurements
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ----------------------------
-- 5. checkins
-- ----------------------------
CREATE TABLE checkins (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date                DATE NOT NULL,
  week                INTEGER,
  wellbeing           INTEGER CHECK (wellbeing >= 1 AND wellbeing <= 10),
  sleep               INTEGER CHECK (sleep >= 1 AND sleep <= 10),
  stress              INTEGER CHECK (stress >= 1 AND stress <= 10),
  nutrition_adherence INTEGER CHECK (nutrition_adherence >= 0 AND nutrition_adherence <= 100),
  missed_workouts     INTEGER,
  complaints          TEXT,
  comment             TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_checkins
  BEFORE UPDATE ON checkins
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ----------------------------
-- 6. photos
-- ----------------------------
CREATE TABLE photos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date       DATE NOT NULL,
  week       INTEGER,
  type       photo_type NOT NULL,
  drive_url  TEXT,
  folder_url TEXT,
  storage_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_photos
  BEFORE UPDATE ON photos
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ----------------------------
-- 7. program_schedule
-- ----------------------------
CREATE TABLE program_schedule (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL,
  sheet_name  TEXT,
  start_date  DATE,
  end_date    DATE,
  focus       TEXT,
  status      TEXT DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_program_schedule
  BEFORE UPDATE ON program_schedule
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ----------------------------
-- 8. exercises
-- ----------------------------
CREATE TABLE exercises (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  muscle_group    TEXT,
  equipment       TEXT,
  difficulty      TEXT,
  demo_video_url  TEXT,
  contraindications TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_exercises
  BEFORE UPDATE ON exercises
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ----------------------------
-- 9. messages
-- ----------------------------
CREATE TABLE messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  coach_id   UUID,
  direction  message_direction NOT NULL,
  text       TEXT NOT NULL,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_messages
  BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ----------------------------
-- 10. notification_log
-- ----------------------------
CREATE TABLE notification_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type       notification_type NOT NULL,
  status     TEXT NOT NULL DEFAULT 'sent',
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_notification_log
  BEFORE UPDATE ON notification_log
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ----------------------------
-- Indexes
-- ----------------------------
CREATE INDEX idx_clients_telegram_id ON clients(telegram_id);
CREATE INDEX idx_clients_connect_code ON clients(connect_code);
CREATE INDEX idx_clients_status ON clients(status);
CREATE INDEX idx_clients_payment_status ON clients(payment_status);

CREATE INDEX idx_programs_active ON programs(active);

CREATE INDEX idx_workout_logs_client_id ON workout_logs(client_id);
CREATE INDEX idx_workout_logs_date ON workout_logs(date);
CREATE INDEX idx_workout_logs_client_date ON workout_logs(client_id, date DESC);

CREATE INDEX idx_measurements_client_id ON measurements(client_id);
CREATE INDEX idx_measurements_date ON measurements(date);
CREATE INDEX idx_measurements_client_date ON measurements(client_id, date DESC);

CREATE INDEX idx_checkins_client_id ON checkins(client_id);
CREATE INDEX idx_checkins_date ON checkins(date);
CREATE INDEX idx_checkins_client_date ON checkins(client_id, date DESC);

CREATE INDEX idx_photos_client_id ON photos(client_id);

CREATE INDEX idx_program_schedule_client_id ON program_schedule(client_id);

CREATE INDEX idx_messages_client_id ON messages(client_id);
CREATE INDEX idx_messages_sent_at ON messages(sent_at);

CREATE INDEX idx_notification_log_client_id ON notification_log(client_id);
CREATE INDEX idx_notification_log_sent_at ON notification_log(sent_at);

-- ----------------------------
-- RLS (basic — no auth yet, but structure is ready)
-- ----------------------------
-- Allow service_role full access (for backend operations)
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
