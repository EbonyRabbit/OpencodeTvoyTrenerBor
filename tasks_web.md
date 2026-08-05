# TASKS_WEB.md — План миграции Telegram-бота на Node.js

> **🔴 P0 (следующие задачи):**
> — нет активных P0 задач

---

## Цель

Перенести Telegram-бота с Google Apps Script (GAS) на Node.js/TypeScript, чтобы Supabase стал единственным источником правды. GAS бот продолжает работать до полного завершения миграции.

---

## Архитектура

### Текущая

```
Telegram → Cloudflare Worker → GAS (Code.gs) → Google Sheets
                                                   ✗
                                              Supabase DB
                                                   ↑
                                            Web-панель (Next.js)
```

### Целевая

```
Telegram → Render (Node.js/grammY) → Supabase DB
                                           ↑
                                    Web-панель (Next.js)
```

---

## Стек

| Компонент | Выбор | Обоснование |
|-----------|-------|-------------|
| Bot framework | **grammY** | TypeScript-first, modern, webhook + long-polling, plugin system |
| Runtime | **Node.js 20+** | LTS, совместимость со всеми библиотеками |
| БД | **Supabase** (PostgreSQL) | Уже настроен, RLS, service-role клиент |
| Cron | **node-cron** | Внутри процесса, достаточно для 15-минутного цикла |
| Фото | **Supabase Storage** | Замена Google Drive |
| Хранение состояний | **Supabase** (таблица `bot_state`) | Единый источник правды |
| Деплой | **Render** | Long-running process, Docker, простая настройка |
| Локализация | **i18next** | ru/en, уже есть паттерн `client.language` |

---

## Структура проекта

```
OpenCode/
├── web/                          ← существующая Next.js (без изменений)
├── bot/                          ← НОВЫЙ Telegram-бот
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile
│   ├── .env.local
│   ├── src/
│   │   ├── index.ts              # Точка входа (webhook/server + cron)
│   │   ├── bot.ts                # Экземпляр grammY + регистрация хендлеров
│   │   ├── config.ts             # Конфигурация (env vars, константы)
│   │   ├── lib/
│   │   │   ├── supabase-admin.ts # Service-role клиент (копия из web/)
│   │   │   ├── types.ts          # Типы БД (копия из web/src/types/)
│   │   │   └── telegram.ts       # Обёртка Telegram API (file download и т.д.)
│   │   ├── handlers/
│   │   │   ├── start.ts          # /start — приветствие, подключение по коду
│   │   │   ├── menu.ts           # /menu, /myprogram
│   │   │   ├── workout.ts        # /today, просмотр/логирование упражнений
│   │   │   ├── checkin.ts        # /checkin — 7-шаговый опрос
│   │   │   ├── measurements.ts   # Замеры тела — 14 шагов
│   │   │   ├── photos.ts         # Загрузка фото (front/side/back/composition)
│   │   │   ├── settings.ts       # /settings — настройки уведомлений
│   │   │   ├── programs.ts       # /programs — каталог программ
│   │   │   ├── pause.ts          # /pause, /resume
│   │   │   └── chat.ts           # Свободный чат (coach ↔ client)
│   │   ├── cron/
│   │   │   ├── scheduler.ts      # Планировщик (node-cron, 15-мин цикл)
│   │   │   ├── morning.ts        # Утреннее уведомление о тренировке
│   │   │   ├── evening.ts        # Вечерний опрос "тренировался?"
│   │   │   ├── measurements.ts   # Напоминание замеров в measurement_day
│   │   │   └── resume.ts         # Автовозобновление пауз + напоминания
│   │   ├── state/
│   │   │   └── machine.ts        # Машин состояний (Supabase-backed)
│   │   └── utils/
│   │       ├── i18n.ts           # Локализация (ru/en)
│   │       ├── timezone.ts       # Timezone-aware утилиты
│   │       └── dedup.ts          # Дедупликация уведомлений
│   └── .env.example
└── supabase/
    └── migrations/
        └── 20260629000000_bot_tables.sql  # НОВАЯ миграция
```

---

## Задачи по фазам

---

### Фаза 1: Инфраструктура и базовая настройка

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| 1.1 | Инициализация проекта `bot/` | Создать `bot/package.json` с зависимостями: `grammy`, `node-cron`, `@supabase/supabase-js`, `date-fns-tz`, `i18next` | ✅ |
| 1.2 | TypeScript конфиг | Создать `bot/tsconfig.json` (target: ES2022, module: NodeNext, strict) | ✅ |
| 1.3 | Конфигурация | Создать `bot/src/config.ts` — чтение env vars, экспорт объекта конфигурации | ✅ |
| 1.4 | Supabase клиент | Скопировать `supabase-admin.ts` из `web/src/lib/` в `bot/src/lib/` | ✅ |
| 1.5 | Типы БД | Скопировать `types/supabase.ts` из `web/src/types/` в `bot/src/lib/types.ts` | ✅ |
| 1.6 | Миграция БД: `bot_state` | Создать таблицу для состояний разговоров (заменяет Bot State sheet) | ✅ |
| 1.7 | Миграция БД: `bot_logs` | Создать таблицу логов бота (заменяет Bot Logs sheet) | ✅ |
| 1.8 | Миграция БД: `bot_schedule` | Создать таблицу отложенных напоминаний (заменяет Bot Schedule sheet) | ✅ |
| 1.9 | .env.local | Настроить переменные окружения (TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, COACH_CHAT_ID) | ✅ |
| 1.10 | Базовый entry point | Создать `bot/src/index.ts` — запуск grammY в режиме webhook | ✅ |
| 1.11 | Dockerfile | Создать Dockerfile для деплоя бота | ✅ |
| 1.12 | Тест запуска | Убедиться, что бот стартует и отвечает на `ping` | ✅ |

---

### Фаза 2: Ядро бота — команды и навигация

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| 2.1 | Базовый `bot.ts` | Экземпляр `Bot`, middleware для логирования, обработка ошибок | ✅ |
| 2.2 | Поиск клиента | Функция `findClientByTelegramId(telegramId)` — запрос в Supabase `clients` | ✅ |
| 2.3 | Команда `/start` | Приветствие: активные клиенты → меню; неактивные → "подключиться по коду"; новые → "купить программу" | ✅ |
| 2.4 | Подключение по коду | Ввод 8-символьного кода → связка `telegram_id` с клиентом в Supabase | ✅ |
| 2.5 | Команда `/menu` | Адаптивный список команд на основе `status` и `payment_status` клиента | ✅ |
| 2.6 | Команда `/myprogram` | Показ текущей программы, ссылки на spreadsheet (если есть), кода подключения | ✅ |
| 2.7 | Машин состояний | Модуль `state/machine.ts`: `getState`, `setState`, `clearState` (Supabase `bot_state`) | ✅ |
| 2.8 | Роутинг callback | Обработка inline-кнопок: `today_open`, `exercise_log:*`, `exercise_skip:*`, `skip_workout`, и т.д. | ✅ |
| 2.9 | Локализация | Утилита `i18n.ts` — выбор языка на основе `client.language` | ✅ |

---

### Фаза 3: Просмотр и логирование тренировок

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| 3.1 | Определение тренировки | Функция `getTodayWorkout(client)` — определение дня недели → поиск в `program_schedule` → чтение плана | ✅ |
| 3.2 | Чтение плана тренировки | Функция `getWorkoutPlan(client, scheduleWeek)` — чтение из Supabase или legacy spreadsheet | ✅ |
| 3.3 | Показ упражнения | Кнопки: "Выполнил" (логирование), "Пропустить", навигация по упражнениям | ✅ |
| 3.4 | Wizard логирования | 5 шагов: подходы → повторы → вес → RPE → комментарий | ✅ |
| 3.5 | Запись результата | INSERT в `workout_logs` (Supabase): client_id, date, week, exercise, sets, reps, weight, rpe, comment | ✅ |
| 3.6 | Пропуск тренировки | Логирование пропуска с причиной | ✅ |
| 3.7 | Отображение прогресса | Показ выполненных упражнений за сегодня | ✅ |
| 3.8 | Evening poll | Ответ "да/нет/перенести" на вечерний опрос | ✅ |

---

### Фаза 4: Замеры тела и фото

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| 4.1 | Начало замеров | Команда или кнопка → запуск 14-шагового wizard | ✅ |
| 4.2 | Wizard замеров | 14 шагов: вес → талия → живот → грудь → бёдра → ягодицы → левое бедро → правое бедро → левая рука → правая рука → % жира → мышечная масса → висцеральный жир → комментарий | ✅ |
| 4.3 | Запись замеров | INSERT в `measurements` (Supabase) | ✅ |
| 4.4 | Показ динамики | Последние 4 замера: дельта веса, талии, живота, груди, бёдер, % жира | ✅ |
| 4.5 | Загрузка фото | Приём фото от пользователя → скачивание через Telegram API → загрузка в Supabase Storage | ✅ |
| 4.6 | Метаданные фото | INSERT в `photos` (Supabase): client_id, week, type (front/side/back/composition), storage_path | ✅ |
| 4.7 | Прогресс-фото | Просмотр последних фото в боте (отправка обратно в чат) | ✅ |

---

### Фаза 5: Чек-ины

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| 5.1 | Начало чек-ина | `/checkin` → запуск 7-шагового опроса | ✅ |
| 5.2 | Wizard чек-ина | 7 шагов: самочувствие(1-10) → сон(часы) → стресс(1-10) → adherence(0-100%) → пропущенные(кол-во) → жалобы(текст) → комментарий | ✅ |
| 5.3 | Запись чек-ина | INSERT в `checkins` (Supabase) | ✅ |
| 5.4 | Уведомление коучу | Отправка сводки чек-ина коучу в Telegram | ✅ |

---

### Фаза 6: Cron и напоминания

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| 6.1 | Планировщик | `cron/scheduler.ts` — node-cron с 15-минутным циклом | ✅ |
| 6.2 | Утреннее уведомление | Проверка `morning_time` каждого клиента → отправка плана тренировки | ✅ |
| 6.3 | Вечерний опрос | Проверка: тренировка существовала + не выполнена + не пропущена → отправка poll в 20:00 | ✅ |
| 6.4 | Напоминание замеров | В `measurement_day` + `measurement_time` → отправка чеклиста замеров | ✅ |
| 6.5 | Дедупликация | Флаги в Supabase: `morning_sent`, `meas_sent`, `workout_completed`, `workout_skipped`, `workout_polled` | ✅ |
| 6.6 | Автовозобновление пауз | При наступлении `resume_date` → вызов `resumePlan()` | ✅ |
| 6.7 | Напоминание возобновления | За 2 дня до `resume_date` → уведомление "приготовьтесь" | ✅ |
| 6.8 | Timezone-aware логика | Корректный расчёт времени с учётом `client.timezone` | ✅ |

---

### Фаза 7: Продвинутое

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| 7.1 | Паузы | `/pause` — запуск wizard: количество → причина → дата возобновления | ✅ |
| 7.2 | Возобновление | `/resume` — ручное возобновление + выбор стратегии (skip/shift/deload/rollback) | ✅ |
| 7.3 | Переиспользование plan-adjustment | Импорт `plan-adjustment.ts` из `web/src/lib/` для логики пауз | ✅ |
| 7.4 | Каталог программ | `/programs` — список активных программ из Supabase `programs` | ✅ |
| 7.5 | Покупка программы | Выбор программы → переход на страницу оплаты (будущее) | ✅ |
| 7.6 | Свободный чат | Пересылка сообщений coach ↔ client через Supabase `messages` | ✅ |
| 7.7 | Админ-команды | `/debug_today`, `recalcSchedule`, `generateCodes` — для тренера | ✅ |

---

### Фаза 8: Переход и выключение GAS

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| 8.1 | Тестирование | Полное тестирование бота на отдельном токене | ✅ |
| 8.2 | Переключение webhook | Изменение `setWebhook` URL: Cloudflare Worker → Render | ⏭️ skipped (фактически уже на Render, см. 12.12) |
| 8.3 | Мониторинг | Наблюдение за работой 24-48 часов | ⏭️ skipped |
| 8.4 | Отключение GAS | Удаление триггера `sendDueMessages` в GAS | ⏭️ skipped |
| 8.5 | Деактивация Worker | Остановка Cloudflare Worker | ⏭️ skipped |
| 8.6 | Очистка | Удаление/архив GAS бота | ⏭️ skipped |

---

### Фаза 9: Улучшение UX и новые фичи

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| **9.1** | Миграция БД: purchase поля | Добавить в `clients`: `purchase_date TIMESTAMPTZ`, `purchased_program_id UUID REFERENCES programs(id)` | ✅ |
| **9.2** | Обновить типы | В `web/src/types/supabase.ts` добавить `purchase_date`, `purchased_program_id` в тип `clients.Row` | ✅ |
| **9.3** | Action `markPurchased` | В `web/src/app/clients/[id]/actions.ts`: валидация (нет программы → ок, есть → блок), установка `program_id`, `status: "active"`, `payment_status: "paid"`, `purchase_date: now()`, `purchased_program_id`, `access_start_date: now()`, `access_end_date: now() + duration_weeks`, генерация `connect_code` если нет `telegram_id`, уведомление клиенту в Telegram | ✅ |
| **9.4** | Модалка "Подтвердить покупку" | В `client-actions.tsx`: заменить кнопку "Отметить оплаченным" на "Подтвердить покупку", dropdown с выбором программы, валидация (если программа уже назначена → ошибка), после подтверждения → показать код подключения или уведомление | done |
| **9.5** | Обновить профиль клиента | В `client-profile.tsx`: показать `purchase_date`, `purchased_program_id` (название программы) в секции "Доступ и программа" | done |
| **9.6** | Обновить бота (минимально) | В `bot/src/handlers/menu.ts`: показать "Оплачено: {название программы}" если `purchased_program_id` | done |
| **9.7** | Fix фото из Supabase Storage | В `web/src/app/clients/[id]/_components/client-profile.tsx` и `photo-gallery.tsx`: добавить отображение фото через `storage_path` (Supabase Storage URL) если `drive_url = null` | ✅ |
| **9.8** | История замеров в боте | Новая команда `/my Measurements` или кнопка "История замеров" — показ последних 10 замеров с дельтами | ✅ |
| **9.9** | История фото в боте | Отправка последних фото (front/side/back) клиенту в чат по запросу | ✅ |
| **9.10** | История тренировок в боте | Новая команда `/mystats` — количество выполненных тренировок, пропусков, средний RPE за месяц | ✅ |
| **9.11** | UI создания клиента | Добавить форму "Добавить клиента" на `/clients` — имя, telegram_id (опционально), язык, timezone, статус оплаты | ✅ |
| **9.12** | UI редактирования клиента | Заменить заглушку "Редактировать" в `client-actions.tsx` на диалог редактирования: name, language, timezone, morning_time, measurement_time, measurement_day. Серверный экшен `updateClient` в `clients/[id]/actions.ts` с валидацией | ✅ |
| **9.13** | Исправление отключения клиента | `disableClient` должен очищать `program_id` при отключении, чтобы `markPurchased` не блокировал повторное подключение | ✅ |
| **9.14** | Кнопка смены статуса оплаты | Добавить кнопку "Снять оплату" / "Отметить оплаченным" в `client-actions.tsx` через `togglePayment`. Добавить `revalidatePath("/clients")` во все экшены для обновления списка | ✅ |

---

## Новые таблицы Supabase

```sql
-- Состояние разговоров (заменяет Bot State sheet)
CREATE TABLE bot_state (
  telegram_id   BIGINT PRIMARY KEY,
  client_id     UUID REFERENCES clients(id) ON DELETE CASCADE,
  action        TEXT,
  step          TEXT,
  data          JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_bot_state
  BEFORE UPDATE ON bot_state
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Логи бота (заменяет Bot Logs sheet)
CREATE TABLE bot_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   TEXT,
  telegram_id BIGINT,
  action      TEXT NOT NULL,
  status      TEXT DEFAULT 'ok',
  details     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bot_logs_created_at ON bot_logs(created_at DESC);
CREATE INDEX idx_bot_logs_client_id ON bot_logs(client_id);

-- Отложенные напоминания (заменяет Bot Schedule sheet)
CREATE TABLE bot_schedule (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,  -- 'measurement_reminder', 'resume_reminder'
  scheduled   TIMESTAMPTZ NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'sent', 'done'
  data        JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bot_schedule_scheduled ON bot_schedule(scheduled) WHERE status = 'pending';
CREATE INDEX idx_bot_schedule_client ON bot_schedule(client_id);

-- Дедупликация уведомлений (заменяет Script Properties флаги)
CREATE TABLE bot_dedup (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT NOT NULL UNIQUE,  -- 'morning_{client_id}_{date}'
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bot_dedup_key ON bot_dedup(key);
CREATE INDEX idx_bot_dedup_expires ON bot_dedup(expires_at);

-- RLS
ALTER TABLE bot_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_dedup ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Full access to authenticated" ON bot_state FOR ALL TO authenticated USING (true);
CREATE POLICY "Full access to authenticated" ON bot_logs FOR ALL TO authenticated USING (true);
CREATE POLICY "Full access to authenticated" ON bot_schedule FOR ALL TO authenticated USING (true);
CREATE POLICY "Full access to authenticated" ON bot_dedup FOR ALL TO authenticated USING (true);

-- GRANT
GRANT ALL ON bot_state TO service_role;
GRANT ALL ON bot_logs TO service_role;
GRANT ALL ON bot_schedule TO service_role;
GRANT ALL ON bot_dedup TO service_role;
```

---

## Миграция данных ( GAS → Supabase )

| GAS хранение | Supabase таблица | Статус |
|-------------|-----------------|--------|
| `Bot Clients` sheet | `clients` | ✅ Таблица уже есть |
| `Bot State` sheet | `bot_state` | 🔨 Создать (Фаза 1) |
| `Bot Schedule` sheet | `bot_schedule` | 🔨 Создать (Фаза 1) |
| `Bot Logs` sheet | `bot_logs` | 🔨 Создать (Фаза 1) |
| Script Properties (флаги) | `bot_dedup` | 🔨 Создать (Фаза 1) |
| `Bot Programs` sheet | `programs` | ✅ Таблица уже есть |
| `Exercise Results Raw` sheet | `workout_logs` | ✅ Таблица уже есть |
| `Check-ins` sheet | `checkins` | ✅ Таблица уже есть |
| `Прогресс тела` sheet | `measurements` | ✅ Таблица уже есть |
| `Photo Uploads` + Google Drive | `photos` + Supabase Storage | ✅ `photos` уже есть |
| Per-client spreadsheets (W1-W12) | Программы в `programs.parsed_content` | ✅ Данные уже в Supabase |

---

## Переиспользуемый код из web/

| Файл | Путь в web/ | Действие |
|------|-------------|----------|
| `supabase-admin.ts` | `web/src/lib/supabase-admin.ts` | Скопировать (12 строк) |
| `types/supabase.ts` | `web/src/types/supabase.ts` | Скопировать (283 строки) |
| `plan-adjustment.ts` | `web/src/lib/plan-adjustment.ts` | Импортировать напрямую |
| `program-utils.ts` | `web/src/lib/program-utils.ts` | Импортировать напрямую |
| `clients.ts` | `web/src/lib/clients.ts` | Импортировать типы |

---

## Переменные окружения

```bash
# Telegram
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...  # Secret token для проверки вебхуков

# Supabase
SUPABASE_URL=http://127.0.0.1:54321  # или production URL
SUPABASE_SERVICE_ROLE_KEY=...

# Coach
COACH_CHAT_ID=...  # Telegram ID тренера для уведомлений

# App
NODE_ENV=development
PORT=3001
WEBHOOK_PATH=/webhook
CLIENT_PORTAL_URL=https://your-web-domain.com  # клиентский портал (команда /myweb)
```

---

## Деплой

### Render

1. Создать проект на Render (Web Service)
2. Подключить GitHub репозиторий
3. Настроить service из `bot/` директории (Dockerfile)
4. Добавить env vars (включая `CLIENT_PORTAL_URL`)
5. Render автоматически соберёт Dockerfile и задеплоит

### Webhook URL

```
Production: https://tvoi-trener-bot.onrender.com/webhook  (уже активен)
Dev:        ngrok http 3001  (для тестирования локально)
```

---

## Приоритеты

1. **P0**: Фазы 1-3 (инфраструктура + ядро + логирование) — бот работает ✅
2. **P1**: Фазы 4-5 (замеры + фото + чек-ины) — полный функционал ✅
3. **P2**: Фаза 6 (cron) — автоматизация ✅
4. **P3**: Фаза 7 (продвинутое) — паузы, чат, программы ✅
5. **P4**: Фаза 8 (переход) — выключение GAS
6. **P5**: Фаза 9 (улучшение UX) — покупка, фото, история, создание клиентов
   - **9.1-9.6**: Покупка программы (P0 внутри фазы)
   - **9.7**: Fix фото из Supabase Storage
   - **9.8-9.10**: История в боте
   - **9.11**: UI создания клиента

---

*Сгенерировано на основе анализа Code.gs (2344 строки), web/src/, и TASKS.md.*

---

## Фаза 10: Система тренировок на веб-платформе

### Контекст

Текущее состояние:
- Программы хранятся в Supabase (`programs.parsed_content` JSON)
- Веб-панель: read-only просмотр программ (accordion по неделям)
- Кнопка «Редактировать» → `/programs/[id]/edit` — **страницы нет**
- Публикация/назначение требуют `template_file_url` (.xlsx)
- Клиенты работают через Telegram бота
- Нет клиентского веб-портала

Цель:
- Тренер создаёт программу через промпт → AI генерирует JSON → заливает в Supabase
- Тренер проверяет и редактирует на вебе
- Клиент видит программу на вебе + Telegram
- Клиент логирует тренировки на вебе и в Telegram (общая база)

### Архитектурные решения

| Решение | Выбор |
|---------|-------|
| Хранение | Supabase как единый источник правды |
| Публикация | Без .xlsx, по `parsed_content` |
| Программы | Шаблоны + персональные — всё в `programs` |
| Редактор | Табличный, 3 уровня: Неделя → День → Упражнение |
| Клиентский портал | `/client/[token]`, магическая ссылка |
| Логирование (веб) | Карточки упражнений, детальное (подходы/повторы/вес/RPE) |
| Синхронизация | Общая база Supabase, Telegram ↔ Веб |
| База упражнений | Автокомплит + ручной ввод |

### Задачи

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| **10.1** | Миграция БД: тип программы | `ALTER TABLE programs ADD COLUMN type TEXT DEFAULT 'template'` + `client_id UUID REFERENCES clients(id)` + индексы | ✅ |
| **10.2** | Миграция БД: токены клиентов | Таблица `client_tokens` (client_id, token, expires_at) | ✅ |
| **10.3** | Обновить типы Supabase | Добавить `type`, `client_id` в `programs.Row` | ✅ |
| **10.4** | Разблокировка публикации | `toggleProgramStatus`: убрать requirement `template_file_url`, проверять `parsed_content` | ✅ |
| **10.5** | Разблокировка назначения | `assignToClient`: убрать requirement `template_file_url` | ✅ |
| **10.6** | Страница редактора | `/programs/[id]/edit` — server component, загрузка программы | ✅ |
| **10.7** | Server action: сохранение | `updateProgramContent(programId, content)` — валидация + запись в Supabase | ✅ |
| **10.8** | Компонент ProgramEditor | Табличный редактор: accordion по неделям → дни → таблица упражнений | ✅ |
| **10.9** | Автокомплит упражнений | Поиск из `exercises` + ручной ввод, debounced | ✅ |
| **10.10** | Типы редактора | `EditableParsedContent`, `EditableWeek`, `EditableDay`, `EditableExercise` | ✅ |
| **10.11** | Обновить program-detail | Убрать алерт «Шаблон не загружен», показать тип программы | ✅ |
| **10.12** | Server action: генерация токена | `generateClientToken(clientId)` — 6-символьный токен, сохранение в `client_tokens` | ✅ |
| **10.13** | Middleware: проверка токена | Маршруты `/client/[token]/*`, проверка валидности, редирект | ✅ |
| **10.14** | Layout клиентского портала | `/client/[token]/layout.tsx` — навигация, мини-дашборд | ✅ |
| **10.15** | Главная страница клиента | `/client/[token]/page.tsx` — приветствие, текущая неделя, навигация | ✅ |
| **10.16** | Просмотр программы | `/client/[token]/program/page.tsx` — недели, дни, упражнения | ✅ |
| **10.17** | Логирование тренировки | Карточки упражнений: подходы/повторы/вес/RPE, кнопка «Завершить» | ✅ |
| **10.18** | Server action: логирование | `logWorkoutFromWeb(clientId, date, exercises[])` — запись в `workout_logs` | ✅ |
| **10.19** | Замеры тела | `/client/[token]/measurements/page.tsx` — форма + история + графики | ✅ |
| **10.20** | Фото прогресса | `/client/[token]/photos/page.tsx` — загрузка + галерея | ✅ |
| **10.21** | Чек-ин | `/client/[token]/checkin/page.tsx` — форма (wellbeing, sleep, stress, adherence) | ✅ |
| **10.22** | Кнопка «Ссылка для клиента» | В `client-profile.tsx`: генерация токена + отображение ссылки | ✅ |
| **10.23** | Бот: команда `/myweb` | Показ ссылки на клиентский портал | ✅ |

| **10.24** | **Настройки уведомлений (клиентский портал)** | `/client/[token]/settings` — клиент сам редактирует время тренировки, время замеров, день замеров, часовой пояс (как в Telegram `/settings`). Server action `updateClientSettings` в `client/[token]/actions.ts` | ✅ |
| **10.25** | **Middleware (proxy.ts → middleware.ts)** | Next.js 16 переименовал `middleware.ts` → `proxy.ts`. Файл уже называется `proxy.ts` с правильным экспортом, задача выполнена. | ✅ |

### Файлы для создания/изменения

| Файл | Действие |
|------|----------|
| `supabase/migrations/..._add_program_type.sql` | Новый |
| `supabase/migrations/..._create_client_tokens.sql` | Новый |
| `web/src/types/supabase.ts` | Изменение (type, client_id) |
| `web/src/app/programs/[id]/actions.ts` | Изменение (убрать .xlsx check) |
| `web/src/app/programs/[id]/edit/page.tsx` | Новый |
| `web/src/app/programs/[id]/edit/actions.ts` | Новый |
| `web/src/app/programs/[id]/edit/_components/program-editor.tsx` | Новый |
| `web/src/app/programs/[id]/edit/_components/exercise-autocomplete.tsx` | Новый |
| `web/src/app/programs/[id]/_components/program-detail.tsx` | Изменение |
| `web/src/app/clients/[id]/actions.ts` | Изменение (generateClientToken) |
| `web/src/app/clients/[id]/_components/client-profile.tsx` | Изменение (кнопка ссылки) |
| `web/src/middleware.ts` | Изменение (client routes) |
| `web/src/app/client/[token]/layout.tsx` | Новый + изменение (добавить "Настройки" в NAV_ITEMS) |
| `web/src/app/client/[token]/page.tsx` | Новый |
| `web/src/app/client/[token]/program/page.tsx` | Новый |
| `web/src/app/client/[token]/measurements/page.tsx` | Новый |
| `web/src/app/client/[token]/photos/page.tsx` | Новый |
| `web/src/app/client/[token]/checkin/page.tsx` | Новый |
| `web/src/app/client/[token]/actions.ts` | Изменение (+ `updateClientSettings`) |
| `web/src/app/client/[token]/settings/page.tsx` | **Новый** |
| `web/src/app/client/[token]/settings/settings-form.tsx` | **Новый** |
| `web/src/lib/program-editor-types.ts` | Новый |
| `bot/src/handlers/menu.ts` | Изменение (/myweb) |

---

## Фаза 11: Миграция фотохранилища на Cloudflare R2

### Контекст

Текущее состояние:
- Фото хранятся в Supabase Storage (`client-photos` bucket)
- Путь: `clients/{clientId}/week{N}_{date}/{type}.{ext}`
- Upload: бот (Telegram → Supabase Storage) + веб (file upload → Supabase Storage)
- Download: signed URLs через `supabase.storage.from("client-photos").createSignedUrl()`
- Legacy: `drive_url` (Google Drive) — не используется, fallback только для старых данных
- Лимиты Supabase Storage: 1 GB free, далее платно

Проблема:
- Supabase Storage free-план ограничен (1 GB)
- Progress-фото весят ~500KB-2MB каждое, ~3-4 фото/клиент/неделю
- При масштабировании (>50 клиентов) Supabase Storage станет узким местом

Цель:
- Миграция на Cloudflare R2 (10 GB бесплатно, без egress fees)
- S3-совместимый API — минимальные изменения в коде
- Сохранить текущую логику signed URLs
- Миграция существующих фото без потерь

### Архитектурные решения

| Решение | Выбор |
|---------|-------|
| Хранилище | Cloudflare R2 |
| SDK | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` |
| Bucket | `client-photos` (тот же name, другой провайдер) |
| Путь | `clients/{clientId}/week{N}_{date}/{type}.{ext}` (без изменений) |
| Signed URLs | `getSignedUrl()` из `@aws-sdk/s3-request-presigner` |
| Migrate script | Скрипт миграции: download from Supabase → upload to R2 |
| Env vars | `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` |

### Задачи

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| **11.1** | Установка SDK | `npm install @aws-sdk/client-s2 @aws-sdk/s3-request-presigner` в `web/` и `bot/` | ⏭️ skipped |
| **11.2** | Утилита R2-клиента | Создать `lib/r2.ts` — функция `getR2Client()` и `getR2SignedUrl(key, expiresIn)` | ⏭️ skipped |
| **11.3** | Обновить env vars | Добавить `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` в `.env.local` и `.env.example` | ⏭️ skipped |
| **11.4** | Обновить bot upload | В `bot/src/lib/photo-utils.ts`: заменить Supabase Storage upload → R2 PutObjectCommand | ⏭️ skipped |
| **11.5** | Обновить bot download | В `bot/src/lib/photo-utils.ts`: заменить `createSignedUrl()` → R2 `getSignedUrl()` | ⏭️ skipped |
| **11.6** | Обновить web upload | В `web/src/app/client/[token]/actions.ts`: заменить Supabase Storage upload → R2 PutObjectCommand | ⏭️ skipped |
| **11.7** | Обновить resolvePhotoUrls | В `web/src/lib/photos.ts`: заменить `supabase.storage.createSignedUrl()` → R2 `getSignedUrl()` | ⏭️ skipped |
| **11.8** | Обновить admin photo pages | В `web/src/app/clients/[id]/photos/page.tsx` и `_components/photo-gallery.tsx`: использовать R2 signed URLs | ⏭️ skipped |
| **11.9** | Скрипт миграции | Создать `scripts/migrate-photos.ts` — скачать все фото из Supabase Storage → загрузить в R2, обновить `storage_path` если нужно | ⏭️ skipped |
| **11.10** | Удалить Supabase Storage код | Убрать все обращения к `supabase.storage.from("client-photos")` | ⏭️ skipped |
| **11.11** | Тест загрузки | Проверить загрузку фото через бот и веб | ⏭️ skipped |
| **11.12** | Тест показа | Проверить показ фото в боте, на веб-админке, в клиентском портале | ⏭️ skipped |

### Файлы для изменения

| Файл | Действие |
|------|----------|
| `web/package.json` | Изменение (новые зависимости) |
| `bot/package.json` | Изменение (новые зависимости) |
| `web/src/lib/r2.ts` | Новый |
| `bot/src/lib/r2.ts` | Новый (копия) |
| `web/src/lib/photos.ts` | Изменение (resolvePhotoUrls → R2) |
| `web/src/app/client/[token]/actions.ts` | Изменение (uploadPhoto → R2) |
| `web/src/app/clients/[id]/photos/page.tsx` | Изменение (если нужен прямой доступ к URL) |
| `web/src/app/clients/[id]/photos/_components/photo-gallery.tsx` | Изменение (если нужен прямой доступ к URL) |
| `bot/src/lib/photo-utils.ts` | Изменение (upload + download → R2) |
| `scripts/migrate-photos.ts` | Новый |
| `.env.local` | Изменение (R2 env vars) |
| `.env.example` | Изменение (R2 env vars) |

---

## Фаза 12: Продакшен деплой

### Контекст

Все фазы (1-11) завершены. Бот и веб задеплоены:
- Бот: Node.js/grammY, Dockerfile, работает на **Render** (`tvoi-trener-bot.onrender.com`)
- Веб: Next.js 16, работает на **Vercel** (`opencode-tvoy-trener-bor.vercel.app`)
- Supabase: продакшен проект `jafxybtbbkmwngqhsoaa`, миграции применены
- Осталось: ручные тесты, ротация GitHub PAT, выключение GAS и Cloudflare Worker

### Архитектура (целевая)

```
Telegram → Render (Node.js/grammY) → Supabase DB (PostgreSQL)
                                            ↑
                                     Vercel (Next.js)
```

### Задачи

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| **12.1** | Создать Supabase проект | Зарегистрироваться на supabase.com, создать проект, получить URL и service_role key | ✅ |
| **12.2** | Заполнить env vars (бот) | В `bot/.env.local`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `COACH_CHAT_ID`, `CLIENT_PORTAL_URL` — реальные значения | ✅ (CLIENT_PORTAL_URL — только локально, см. 12.7) |
| **12.3** | Заполнить env vars (веб) | В `web/.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — реальные значения | ✅ |
| **12.4** | Запустить миграции | Применить все миграции из `supabase/migrations/` (13 файлов) на продакшен через Supabase CLI `db push` | ✅ |
| **12.5** | Исправить middleware | Next.js 16 использует `proxy.ts` (не `middleware.ts`). Файл уже корректный. | ⏭️ not needed |
| **12.6** | Деплой бота | Бот развёрнут на **Render** (не Railway): `tvoi-trener-bot.onrender.com`, `/health` → 200 | ✅ |
| **12.7** | Env vars бота | Переменные из 12.2 заданы на Render (webhook работает, бот жив), **кроме** `CLIENT_PORTAL_URL` — задан только локально в `bot/.env.local` (gitignored), на Render добавить вручную, иначе `/myweb` ответит «портал не настроен» | ⏳ (добавить CLIENT_PORTAL_URL на Render) |
| **12.8** | Проверить деплой бота | `GET /health` → `{"ok":true}`; webhook принимает апдейты (`pending_update_count: 0`) | ✅ |
| **12.9** | Создать Vercel проект | Веб развёрнут: `https://opencode-tvoy-trener-bor.vercel.app` (root directory = `web/`) | ✅ |
| **12.10** | Настроить Vercel env vars | Переменные из 12.3 заданы (страницы рендерятся, база отвечает) | ✅ |
| **12.11** | Проверить деплой веба | `/` → 200, `/login` → 200, `/clients/...` → 307 (редирект на auth), клиентский портал `/client/[token]` → 200 | ✅ |
| **12.12** | Переключить webhook | `setWebhook` = `https://tvoi-trener-bot.onrender.com/webhook`, secret token задан | ✅ |
| **12.19** | Витрина программ + заявки на покупку | Бот: кнопка «📚 Смотреть программы» в `/start`, каталог шаблонов (active=true, client_id IS NULL), кнопка «Купить» → `/buy/{id}?tg={telegramId}`. Веб: публичная страница `/buy/[id]` (формы, валидация, rate-limit 5/мин, dedup 120с), заявка в `bot_logs` (action=`purchase_request`), уведомление коучу в Telegram. Commit `e329e4f`, ревью 9.5/10. Деплой: на Render `CLIENT_PORTAL_URL`+`PAYMENT_BASE_URL`, на Vercel `TELEGRAM_BOT_TOKEN`+`COACH_CHAT_ID` — добавлены, e2e-тест заявки ✅ (логика `b9b19d54…`, уведомление коучу пришло) | ✅ (код) |
| **12.20** | Фиксы после продакшен-теста | Роутинг `message:text` (state-флоу → игнор неизвестных `/команд` → coach → free-text), команда `/settings` → портал, DB-дедупликация заявок через `bot_dedup` (мульти-инстанс, окно 15 мин), мультивыбор тренировочных дней (7 дней, ✅/⚪️, plural ru). Commit `a33a384`, ревью 9.5/10 | ✅ |
| **12.21** | Фокус тренировки + дни клиента + запрос программы | «Фокус» на уровне дня в редакторе программ (показ в `/today` и превью; убран фейковый `Фокус: неделя N` из лейбла недели). Отображение реальных тренировочных дней клиента в `/today`, `/myprogram` и веб-вкладке «Тренировка» (были имена дней из программы). Запрос программы: уведомление коучу с контактом клиента (@username/ссылка), логирование `program_request`/`coach_notification_failed` в `bot_logs`. Commits `7a62e7f`, `23cfb4a`, `2a65ba5`. Ревью 9.0→фиксы lang/таймзоны. Проверено в продакшене ✅ | ✅ |
| **12.13** | Тест бота в продакшене | `/health` OK; проверить команды `/start`, `/menu` — вручную в Telegram | ⏳ |
| **12.14** | Тест веба в продакшене | Страницы открываются; залогиниться в админку — вручную | ⏳ |
| **12.15** | Тест end-to-end | Полный цикл: бот → веб → замеры → чек-ин (вручную) | ⏳ |
| **12.16** | Ротировать GitHub PAT | ⚠️ В `git remote` URL зашит PAT. Создать новый минимальный PAT, сменить remote | ⏳ |
| **12.17** | Отключить GAS | Удалить триггер `sendDueMessages` в Google Apps Script | ⏳ |
| **12.18** | Остановить Worker | Деактивировать Cloudflare Worker (не удалять сразу) | ⏳ |

---

## Фаза 13: Корректный подсчёт тренировок + История как таблица плана

### Контекст

Проблемы:
- Счётчик «выполненных тренировок» нигде не соответствует плану:
  - портал «Текущая неделя» (`page.tsx`) считал **строки** `workout_logs`
    (по одной на упражнение) → «8 тренировок» из 8 упражнений;
  - `adherence.ts` считал уникальные даты с любым логом (частичная и
    пропущенная тренировка засчитывались);
  - бот `/mystats` — день с ≥1 логом ≠ выполненная тренировка, псевдо-строки
    (`[EVENING_*]`) считались реальными.
- «История тренировок» (`client/[token]/history`) — строки = дни, в ячейках
  только вес + подходы×повторы (нет RPE, комментария, даты).

Решение:
- `day_order` в `workout_logs` — точная привязка лога к дню плана
  (пишется ботом при логировании + бэкфилл старых данных).
- Единый алгоритм подсчёта (веб и бот): тренировка выполнена, если в
  запланированную дату залогированы **все** упражнения дня
  (`weekday → training_days → day_order → план`).
- История = таблица как в плане: строки = упражнения, столбцы = все недели,
  в ячейке вес, подходы×повторы, RPE, комментарий, дата; пропуск помечается.

### Задачи

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| **13.1** | Миграция: `day_order` | `ALTER TABLE workout_logs ADD COLUMN day_order INTEGER;` — применена к production через Management API | ✅ |
| **13.2** | Бэкфилл `day_order` | `bot/scripts/backfill-workout-day-order.ts`: `isoWeekday(date)` → `training_days` → `day_order`; для `[SKIP]` ещё `week` по дате; idempotent — выполнен (6 обновлено, 2 пропущено) | ✅ |
| **13.3** | Бот: запись `day_order` | `workout-utils.ts` (`TodayWorkout.day_order`, экспорт `getIsoWeekday`/`dayOrderForDate`/`matchDayByOrder`/`isPseudoName`); `wizard.ts` → insert; skip → `week`+`day_order`; evening-poll → `day_order` | ✅ |
| **13.4** | Бот: `/mystats` по плану | `my-stats.ts`: completed = полное покрытие плана, skipped отдельно, псевдо-строки исключены | ✅ |
| **13.5** | Веб: `adherence.ts` | `calculateAdherence(+trainingDays, лог +exercise)`; частичные/пропуски не считаются; fallback по `day_order`; реген `src/types/supabase.ts` (+`day_order`), фикс `ClientWithProgram` под строгий select-парсинг | ✅ |
| **13.6** | Портал: «Текущая неделя» | `client/[token]/page.tsx`: +`exercise` в select, замена inline-счётчика строк на план-подсчёт через `adherence.weeks` | ✅ |
| **13.7** | Дашборд тренера | `clients/[id]/workouts/page.tsx`: +`training_days` у клиента, +`exercise` в select логов | ✅ |
| **13.8** | История: таблица как план | `client/[token]/history/page.tsx` + `history-grid.tsx`: строки = упражнения (секции по дням), столбцы = недели, ячейка = вес/подходы×повторы/RPE/коммент/дата; бейдж «⏭ пропуск» (legacy-скипы: дата → неделя/день); матчинг по `day_order`, иначе по имени | ✅ |
| **13.9** | Тесты бота | vitest: `getIsoWeekday`, `dayOrderForDate`, `matchDayByOrder`, `isPseudoName` (+ существующие) — 154/154 ✅ | ✅ |
| **13.10** | Верификация + gate | bot `tsc` ✅ + vitest (160) ✅; web `tsc` ✅ + vitest (15) ✅ + `next build` ✅; код-ревью 4 раунда (7.6 → 8.7 → 9.3 → **9.5**); TASKS.md; коммит+push (Render/Vercel); бэкфилл после деплоя | ✅ |

### Осознанные решения (задокументировано после ревью)

- **Точный матчинг имён** (I6): тренировка считается выполненной только при
  совпадении ВСЕХ имён плана после `trim().toLowerCase()`. Опечатка клиента
  или «Жим лежа» vs «Жим лёжа» не засчитается — это компромисс в пользу
  строгого учёта; нормализация (схлопывание пробелов, ё→е) — на будущее.
- **Частичная тренировка не отображается в /mystats** (M1): день с частью
  логов не попадает ни в «выполнено», ни в «пропущено». В вебе такой день
  виден как «не выполнено» (снижает %). Третий бакет «частично» — на будущее.
- **Разная семантика путей подсчёта**: date-путь (с `training_days`) требует
  все упражнения на точную плановую дату; order-путь (fallback) допускает
  набор по `day_order` с любой даты недели + подмешивание логов плановой даты.
  Fallback-путь — для legacy-клиентов без `training_days`.
- **Неизвестный `day_name`** (напр. англ. «Monday») не даёт future-фильтр
  в order-пути: день всегда считается наступившим. Программы хранятся
  на русском, поэтому в проде не проявляется.
- **Скип-бейдж в истории**: при двух скипах на один день/неделю побеждает
  первый (по дате), причина последнего отбрасывается.
- **Асимметрия бот/веб при двойном логировании** (P3.4): если тренировка
  залогирована и на плановой дате (legacy, без `day_order`), и повторно с
  `day_order` в другой день, веб засчитает день один раз, а `/mystats`
  может дать два «выполнено» (счёт по датам). Принято, клампинг — на будущее.
- **Дублирование `plannedDateForDay`** (P3.6): приватная копия в
  `web/src/lib/adherence.ts` + экспорт из `bot/src/lib/workout-utils.ts`;
  вынесение в общий пакет отложено, реализации синхронизированы.

### Файлы для создания/изменения

| Файл | Действие |
|------|----------|
| `supabase/migrations/20260804000000_add_workout_logs_day_order.sql` | Новый |
| `bot/scripts/backfill-workout-day-order.ts` | Новый |
| `bot/src/lib/workout-utils.ts` | Изменение (day_order, matchDayForDate, isPseudoName) |
| `bot/src/handlers/wizard.ts` | Изменение (WizardData.day_order, insert) |
| `bot/src/handlers/callbacks.ts` | Изменение (skip: week+day_order) |
| `bot/src/handlers/evening-poll.ts` | Изменение (day_order) |
| `bot/src/handlers/my-stats.ts` | Изменение (план-подсчёт) |
| `web/src/lib/adherence.ts` | Изменение (план-подсчёт) |
| `web/src/app/client/[token]/page.tsx` | Изменение (current-week фикс) |
| `web/src/app/clients/[id]/workouts/page.tsx` | Изменение (training_days, exercise) |
| `web/src/app/client/[token]/history/page.tsx` | Изменение (таблица как план) |
| `web/src/app/client/[token]/history/history-grid.tsx` | Изменение (полные данные в ячейках) |

---

## Фаза 14 — Счётчик «Тренировок» в блоке «Статистика» тренера

### Проблема

В `clients/[id]` блок «Статистика» показывал «Тренировок» = сырое количество
строк `workout_logs` (8 упражнений одного дня = «8 тренировок» вместо 2).

### Решение

- Серверный RPC `count_client_workout_days(client_id)` — подсчёт по правилам
  Фазы 13 (полное покрытие упражнений планового дня), а не строк логов.
- `SECURITY INVOKER`, пустой `search_path`, `authenticated`/`service_role`.
- timezone клиента валидируется через `pg_timezone_names` (fallback Moscow);
  JSON-разбор программы защищён от legacy/malformed структур.
- При ошибке RPC UI показывает `—` (не ложный ноль); ошибка логируется.
- `web/src/lib/workout-stats.ts` (`resolveWorkoutCount`) + 3 теста;
  `adherence.ts`: псевдо-упражнения `[...` исключаются и из плана (+ тест).
- Индекс `(client_id, date)`.

### Задачи

| # | Задача | Описание | Статус |
|---|--------|----------|--------|
| **14.1** | RPC + миграция | `20260804010000_count_client_workout_days.sql` — применена к production через Management API | ✅ |
| **14.2** | Веб-интеграция | `page.tsx` → `rpc`, `resolveWorkoutCount`, `—` при ошибке, тип в `supabase.ts` | ✅ |
| **14.3** | Тесты | `workout-stats.test.ts` (3), `adherence.test.ts` (16: псевдо-упражнение в плане) — 19/19 | ✅ |
| **14.4** | Верификация + gate | web `tsc` ✅ + vitest (19) ✅ + `next build` ✅; ревью 2 раунда (8.7 → 9.3 → **9.8**); production RPC проверен: 8 строк → **2** тренировочных дня | ✅ |
| **14.5** | Деплой | коммит + push (Vercel) | ✅ |

### Файлы

| Файл | Действие |
|------|----------|
| `supabase/migrations/20260804010000_count_client_workout_days.sql` | Новый |
| `web/src/lib/workout-stats.ts` + `.test.ts` | Новые |
| `web/src/app/clients/[id]/page.tsx` | Изменение (RPC вместо count) |
| `web/src/app/clients/[id]/_components/client-profile.tsx` | Изменение (`—` при ошибке) |
| `web/src/types/supabase.ts` | Изменение (тип RPC) |
| `web/src/lib/adherence.ts` + `.test.ts` | Изменение (псевдо-упражнения в плане) |
