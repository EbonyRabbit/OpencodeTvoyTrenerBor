-- Фаза 16: месячные замеры + еженедельный чек-ин
-- 1) Новые поля клиента: расписание чек-ина и дефер замеров
--    Колонки добавляются БЕЗ дефолта: бэкфилл ниже решает, кому что ставить.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS checkin_day INTEGER;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS checkin_time TIME;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS measurement_defer_date DATE;

-- 2) Смена семантики measurement_day: ISO-день недели (1-7) -> число месяца (1-31)
--    ОДНОРАЗОВАЯ конвертация старых значений (в первую применение миграции).
--    Гард measurement_day <= 7 конвертирует только «старые» ISO-значения.
--    См. примечание внизу файла о повторном запуске.
UPDATE clients
   SET measurement_day = 1,
       measurement_time = '08:00'
 WHERE measurement_day IS NOT NULL
   AND measurement_day <= 7;

-- 3) Дефолт еженедельного чек-ина: воскресенье 10:00 для активных с Telegram
--    (для всех остальных — NULL, чтобы не включать напоминания неактивным).
--    Гард по NULL: повторный запуск не перезапишет уже заданное тренером расписание.
UPDATE clients
   SET checkin_day = 7,
       checkin_time = '10:00'
 WHERE status = 'active'
   AND telegram_id IS NOT NULL
   AND (checkin_day IS NULL OR checkin_time IS NULL);

-- 4) Дефолты на НОВЫЕ строки (созданные после этой миграции):
--    новые клиенты сразу получают 1-е число 08:00 и воскресенье 10:00
ALTER TABLE clients ALTER COLUMN measurement_day SET DEFAULT 1;
ALTER TABLE clients ALTER COLUMN measurement_time SET DEFAULT '08:00';
ALTER TABLE clients ALTER COLUMN checkin_day SET DEFAULT 7;
ALTER TABLE clients ALTER COLUMN checkin_time SET DEFAULT '10:00';

-- ⚠️ ПРИМЕЧАНИЕ: шаг 2 — одноразовая конвертация старой семантики.
-- После первого применения значения measurement_day 1-7 неотличимы от «новых»
-- чисел месяца, поэтому повторный запуск файла может перезаписать вручную
-- настроенные расписания. Не перезапускайте миграцию повторно на прод-базе.