-- Seed data for local development

INSERT INTO programs (title, description, type, duration_weeks, language, active)
VALUES
  ('Сила/Гипертрофия 12 недель', 'Классический сплит PPL/Upper-Lower, 3 фазы: гипертрофия → сила → смешанная', 'strength_hypertrophy', 12, 'ru', true),
  ('HYROX подготовка 12 недель', 'Специализированная программа подготовки к HYROX: бег + силовые станции', 'hyrox', 12, 'ru', true),
  ('Домашние тренировки 4 недели', 'Базовый старт с минимальным инвентарём', 'home', 4, 'ru', true);

INSERT INTO exercises (name, muscle_group, equipment, difficulty)
VALUES
  ('Жим штанги лёжа', 'Грудь', 'Штанга, скамья', 'beginner'),
  ('Приседания со штангой', 'Ноги', 'Штанга, стойка', 'intermediate'),
  ('Тяга штанги в наклоне', 'Спина', 'Штанга', 'intermediate'),
  ('Становая тяга', 'Спина', 'Штанга', 'advanced'),
  ('Жим гантелей сидя', 'Плечи', 'Гантели, скамья', 'beginner');
