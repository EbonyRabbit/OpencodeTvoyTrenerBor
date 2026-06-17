# Telegram Fitness Bot

Бот для онлайн-фитнес коучинга: автономная продажа программ, тренировки, замеры, чек-ины, уведомления.

## Архитектура

### Общая таблица
`1XVoPSYgRx-liLPSZsmMhOva0AIxs60U6Hf7Cm8lLxK4`

| Лист | Назначение |
|---|---|
| `Bot Clients` | Все клиенты: статус, код, программа, оплата |
| `Bot State` | Состояния диалогов (логирование, замеры, чек-ин) |
| `Bot Schedule` | Отложенные напоминания |
| `Bot Logs` | Логи действий бота |
| `Bot Program Schedule` | Расписание недель по датам (COMMON — общее) |
| `Bot Programs` | Каталог программ для продажи |
| `Check-ins` | Результаты чек-инов |

### Личная таблица клиента (создаётся ботом или вручную)

Содержит копию шаблона программы (`W1`…`W12`) + системные листы:
- `Прогресс тела` — замеры (видимый)
- `Фото и состав тела` — фото (видимый)
- `Exercise Results Raw` — сырые логи (скрытый)
- `Bot Program Schedule` — расписание (скрытый)

Доступ: `Anyone with link → Viewer`. Клиент не редактирует таблицу — всё через Telegram.

### Структура листов программы

**HYROX (13 колонок):**
Plan: `Раздел | Упражнение | План подходы | План повторы | План вес | RPE/RIR | Темп | Отдых`
Fact:  `Факт подходы | Факт повторы | Факт вес | Факт RPE | Комментарий клиента`

**Strength/Hypertrophy (8 колонок, без факт-колонок):**
`Блок | Упражнение | Подходы | Повторы | Вес/% 1ПМ | RPE | Отдых | Заметки`

Бот динамически ищет факт-колонки по заголовкам (`findHeaderRow`). Если не находит — fallback на 9-13.

## Команды

| Команда | Описание |
|---|---|
| `/start` | Новый → «У меня есть код» / «Купить программу». Активный → `/menu`. Неактивный → reconnect |
| `/programs` | Каталог программ с ценами, описанием, инвентарём |
| `/myprogram` | Информация о программе + ссылка на таблицу + код |
| `/today` | Тренировка на сегодня (показывает по **дню недели**, не по дате) |
| `/progress` | Замеры тела и фото |
| `/checkin` | Еженедельный чек-ин (7 шагов) |
| `/settings` | Настройка времени уведомлений и часового пояса |
| `/menu` | Список команд |

## Цикл нового клиента (автономная продажа)

1. Находит бота → `/start` → приветствие, две кнопки
2. Выбирает программу из `/programs` → вводит имя → `payment_status=pending`
3. Бот: «Заявка отправлена. После оплаты получите доступ.»
4. Тренер в `Bot Clients` ставит `payment_status=paid`
5. Тренер запускает `activatePendingPrograms()`:
   - Копирует шаблон программы
   - Добавляет системные листы (служебные — скрытые)
   - Включает доступ по ссылке (только просмотр)
   - Заполняет `Bot Program Schedule` (в личной таблице клиента)
   - Генерирует `connect_code`
   - Отправляет клиенту ссылку + код
6. Клиент начинает тренироваться

## Платежи

Пока ручные:
1. Клиент оставляет заявку (`payment_status=pending`)
2. Тренер подтверждает оплату → `payment_status=paid`
3. Запускает `activatePendingPrograms()`

## Как устроены тренировки

- Программа — Google Sheets с листами `W1`…`W12`
- Каждый лист: заголовки дней недели (напр. `Пятница | Гипертрофия`) + упражнения
- Бот определяет сегодняшнюю тренировку по **дню недели** (не по дате)
- Текущая неделя определяется через `Bot Program Schedule` (по датам)
- Fallback: если сегодня нет тренировки — показывает следующую

### Пошаговое логирование упражнения

1. `/today` → список упражнений
2. «✅ Выполнил» → запрос подходов → повторов → веса → RPE → комментария
3. Данные пишутся в факт-колонки недельного листа + `Exercise Results Raw`
4. Автоматически переход к следующему упражнению

## Фото

1. `/progress` → замеры → фото спереди, сбоку, сзади (или пропустить)
2. `uploadPhotoToDrive()`: Telegram file → Google Drive
3. Структура в Drive: `{root} / {client_name || client_id} / W{week}_{date} / фото`
4. Ссылка записывается в `Фото и состав тела` (личная таблица)
5. Лог в `Photo Uploads`

**Нюанс:** для авто-клиентов имя берётся из `client.name`. Используется `client.client_name` в некоторых местах — для авто-клиентов будет `undefined`, папка создаётся с `client_id`.

## Disconnect / Reconnect

- `status ≠ active` → все команды кроме `/start` блокируются
- `/start` для неактивного → запрос кода → `connectClientByCode()` → очищает старый `telegram_id` → подключает заново
- `generateNewConnectCodes()` — генерация 8-символьных кодов для клиентов без них

## Функции для админа (запускать из редактора)

| Функция | Назначение |
|---|---|
| `activatePendingPrograms()` | Активировать оплаченные заявки |
| `generateNewConnectCodes()` | Сгенерировать коды для всех без кода |
| `recalcClientSchedule(clientId)` | Пересчитать расписание для одного клиента |
| `recalcAllClientSchedules()` | Пересчитать расписание для всех |
| `setWebhook()` | Установить вебхук |
| `getWebhookInfo()` | Проверить вебхук |
| `sendDueMessages()` | (По триггеру) Отправить отложенные уведомления |

## Известные проблемы

1. **Сдвиг колонок** (FIXED) — `logExerciseResult` писал в 11-15 вместо 9-13. Исправлено динамическим поиском колонок через `findHeaderRow`. Если факт-колонок нет в шаблоне (strength, 8 колонок) — fallback на 9-13, данные пишутся за пределами шапки.
2. **Устаревшие шаблоны с датами** — если в шаблоне в заголовках дней есть даты (напр. `Пятница 12.06.2026 | Гипертрофия`), их нужно удалить. Бот ищет день по названию (`Пятница`), даты мешают `isWorkoutDayTitle()`.
3. **Старое расписание у тестового клиента** — активирован до фикса `fillProgramSchedule`. Запустить `recalcTestClientSchedule()`.

## Структура Code.gs (~1880 строк, основные функции)

| Раздел | Строки | Описание |
|---|---|---|
| CONFIG + helpers | 1–101 | Конфиг, работа с листами |
| Week/schedule | 102–160 | `getActiveWeekSheetName`, `getActiveProgramForClient` |
| Bot state | 161–210 | `getStateByTelegramId`, `upsertState` |
| Sending | 211–300 | `sendMessage`, `button`, клавиатуры |
| Callback handler | 301–610 | `handleCallback` — логика всех кнопок |
| Bot commands | 611–722 | `/start`, `/today`, `/progress`, `/checkin`, `/settings`, `/menu` |
| Exercise logging | 723–891 | `getTodayWorkout`, `showExercise`, `startExerciseLogging`, `continueExerciseLogging`, `logExerciseResult` |
| Measurements | 869–945 | `startMeasurements`, `continueMeasurements`, `saveMeasurements` |
| Photo upload | 946–996 | `uploadPhotoToDrive`, `savePhotoUpload`, `writePhotoToClientSheet` |
| Due messages | 1013–1170 | `sendDueMessages`, авто-напоминания |
| Check-in | 1171–1370 | Чек-ин логика |
| Settings | 1382–1505 | Настройки клиента |
| Program schedule | 1506–1562 | `createBotProgramSchedule`, `fillProgramSchedule` |
| Program catalog | 1607–1650 | `getPrograms`, `showPrograms` |
| Registration | 1651–1777 | `registerClient`, `activatePendingPrograms` |
| Spreadsheet creation | 1782–1860 | `createClientSpreadsheet`, `ensureSystemSheets` |
| Admin utils | 1861–1877 | `recalcClientSchedule`, `recalcAllClientSchedules` |

## Установка

1. Открой Google Sheets.
2. `Расширения → Apps Script`.
3. Вставь `Code.gs`.
4. Сохрани проект.

### Script Properties

| Property | Value |
|---|---|
| `BOT_TOKEN` | Токен от BotFather |
| `WEB_APP_URL` | URL опубликованного Web App (Worker URL) |

### Worker

Cloudflare Worker (`telegram_bot_worker/worker.js`) — простой прокси:
- GET / → проверка
- POST / → пересылает на `WEB_APP_URL` (без ручного следования 302)

### Deploy

1. `Deploy → New deployment`
2. Тип: `Web app`
3. Execute as: `Me`
4. Who has access: `Anyone`
5. Скопируй URL → в `WEB_APP_URL`
6. Запусти `setWebhook()`

### Триггеры

1. `Triggers → Add Trigger`
2. Function: `sendDueMessages`
3. Time-driven → Minutes timer → Every 15 minutes

### Bot Programs (каталог)

Запусти `getPrograms()` — создаст лист `Bot Programs`. Заполни:

| id | title | description | equipment | price | template_id | active |
|---|---|---|---|---|---|---|
| hyrox | HYROX 12 недель | Бег + силовые станции | гантели, штанга | 5000 | `<sheet-id>` | TRUE |

`template_id` — ID Google Sheets файла с листами `W1`…`W12`.

## Ручное добавление клиента

1. Создать личную таблицу клиента (скопировать шаблон + добавить системные листы)
2. Записать строку в `Bot Clients`: `client_id`, `telegram_id`, `connect_code`, `status=active`, `spreadsheet_id`
3. Клиент нажимает `/start` → вводит код → подключён

## Структура `Bot Clients`

| Колонка | Описание |
|---|---|
| `client_id` | Уникальный ID |
| `telegram_id` | Чат Telegram |
| `name` | Имя клиента |
| `status` | `active` / `неактивен` |
| `payment_status` | `none` / `pending` / `paid` |
| `program_id` | Выбранная программа |
| `connect_code` | Код для подключения |
| `spreadsheet_id` | ID личной таблицы клиента |
| `morning_time` | Время утренней тренировки |
| `measurement_time` | Время замеров |
| `measurement_day` | День замеров |
| `timezone` | Часовой пояс |

## Важно

- Даты в заголовках дней не нужны — бот определяет день по названию (`Пятница`)
- Шаблоны программ переиспользуются для всех клиентов
- Фото клиентов сохраняются в Google Drive (`DEFAULT_DRIVE_ROOT_FOLDER_ID`)
- Служебные листы (`Exercise Results Raw`, `Bot Program Schedule`) скрыты от клиента
- Файл AGENTS.md в корне проекта содержит полный контекст для AI-агента (роль, правила, стек)
- ROADMAP.md отслеживает сделанное и планы
