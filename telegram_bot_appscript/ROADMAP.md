# Telegram Bot Roadmap

## ✅ Done

### Core
- [x] `/start` — умное приветствие: новым → «У меня есть код» / «Купить программу», активным → меню, неактивным → reconnect
- [x] `/menu` — список команд (адаптивный под статус и payment_status)
- [x] Поддержка нескольких клиентов на одном Telegram-аккаунте
- [x] Переключение между клиентами через `/start` + код
- [x] Очистка старого `telegram_id` при переподключении

### Workout (`/today`)
- [x] Показ тренировки по **дню недели** (не по дате)
- [x] Пошаговое логирование: сеты → повторы → вес → RPE → комментарий
- [x] Запись факта в недельный лист (динамический поиск колонок через `findHeaderRow`) + `Exercise Results Raw`
- [x] Кнопка «Пропустить тренировку» с опциональной причиной
- [x] Вечерний авто-опрос (20:00–24:00): «Ты сегодня тренировался?»

### Progress (`/progress`)
- [x] Сбор замеров тела (вес → обхваты → фото)
- [x] Сохранение фото в Google Drive (корневая папка → клиент → W{week}_{date})
- [x] Запись в `Прогресс тела` + `Фото и состав тела`

### Check-in (`/checkin`)
- [x] 7-шаговый чек-ин → запись в `Check-ins`

### Notifications (time‑triggered)
- [x] Утренняя рассылка тренировки
- [x] Напоминание о замерах (3 попытки)
- [x] Фильтр: только `payment_status=paid` или старые клиенты (без payment_status)

### Admin
- [x] Отключение клиента: `status ≠ active` → блок всех команд, кроме `/start`
- [x] Переподключение по новому коду
- [x] `generateNewConnectCodes()` — генерация кодов
- [x] Очистка старого `telegram_id` при переподключении
- [x] `recalcClientSchedule(clientId)` / `recalcTestClientSchedule()` / `recalcAllClientSchedules()`

### Автономная продажа программ
- [x] `/programs` — каталог из `Bot Programs`
- [x] `/myprogram` — информация о программе + ссылка на таблицу
- [x] Регистрация нового клиента: выбирает программу → вводит имя → `payment_status=pending`
- [x] `/today /progress /checkin` не работают, пока `payment_status ≠ paid`
- [x] `activatePendingPrograms()` — копирует шаблон, создаёт личную таблицу, настраивает доступ (Anyone with link → Viewer), генерирует код, уведомляет клиента
- [x] Служебные листы (`Exercise Results Raw`, `Bot Program Schedule`) — скрыты
- [x] `client_id = {имя}_{telegramId}`

### Schedule logic
- [x] `fillProgramSchedule()` — строит расписание на 12 недель от даты из шаблона (или сегодня)
- [x] `parseProgramStartDate()` — читает `Период: dd.mm.yyyy` из W1
- [x] `createBotProgramSchedule()` — пересоздаёт скрытый лист с чистым расписанием

### Settings (`/settings`)
- [x] morning_time, measurement_time, measurement_day, timezone
- [x] `ensureMeasurementTimeColumn()` — добавляет колонки если их нет

### Webhook
- [x] Cloudflare Worker прокси (простой POST без ручного следования 302)

### Excel генерация
- [x] `home_workout_program.py` — генератор для программы «Базовый старт» (4 нед, 4 дня/нед, гантели 3 кг + резинки)
- [x] `hyrox_program.py` — 12-нед HYROX программа
- [x] `strength_hypertrophy_program.py` — 12-нед сила/гипертрофия

## 🔜 Next

### Medium Priority
- [ ] `/history` — результаты последних N тренировок
- [ ] `/stats` — динамика весов по упражнениям
- [ ] Редактирование результата упражнения
- [ ] Перенос тренировки на другой день
- [ ] Кнопка «Пропустить шаг» на каждом этапе чек-ина
- [ ] Автоматическая оплата (Stripe / ЮKassa)

### Low Priority
- [ ] Уведомления о достижениях (личные рекорды, streaks)
- [ ] Telegram Inline Mode — быстрый ввод веса
- [ ] Выгрузка отчёта PDF за месяц

### Tech Debt
- [ ] Вынести CONFIG в Script Properties
- [ ] Заменить `client.client_name` на `client.name || client.client_id` везде
- [ ] JSDoc документация функций
- [ ] Очистить старые шаблоны от дат в заголовках дней
- [ ] Проверить работу `logExerciseResult` для шаблона strength (8 колонок, нет факт-колонок)
