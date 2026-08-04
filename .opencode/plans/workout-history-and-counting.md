# План: подсчёт тренировок + История как таблица плана

## Общая база: `day_order` в `workout_logs`
- Миграция `supabase/migrations/20260804000000_add_workout_logs_day_order.sql`:
  `ALTER TABLE workout_logs ADD COLUMN day_order INTEGER;`
- Применение: `npx supabase db push` (CLI v2.110.0 есть, проект прилинкован `jafxybtbbkmwngqhsoaa`).
- Бэкфилл `bot/scripts/backfill-workout-day-order.ts` (idempotent, для NULL):
  `isoWeekday(date)` -> индекс в `training_days` -> `day_order=index+1`; для `[SKIP]` ещё и `week` по дате.
- Бот при записи: wizard -> `day_order`; skip -> `week`+`day_order`; evening-poll -> `day_order`.

## Задача 1: корректный подсчёт выполненных тренировок
Определение: выполнена = все упражнения запланированного дня залогированы в запланированную дату.

Алгоритм (веб и бот одинаково):
- для каждой недели расписания (прошлая/текущая), для даты в [start, min(end, today)]:
  weekday -> индекс в training_days -> day_order -> план дня; упражнения есть -> expected++,
  полное покрытие логами -> completed++; [SKIP] на дате -> skipped++.
  Если training_days пуст -> fallback на сохранённый day_order.

Файлы:
- `web/src/lib/adherence.ts` — переписать calculateAdherence (+trainingDays, +exercise в логах).
- `web/src/app/client/[token]/page.tsx:100-111` — заменить inline currentWeekStats (баг «8 тренировок»).
- `web/src/app/clients/[id]/workouts/page.tsx` — +training_days у клиента, +exercise в select логов.
- `bot/src/handlers/my-stats.ts` — план-подсчёт, isPseudoName, skipped отдельно.
- `bot/src/lib/workout-utils.ts` — TodayWorkout.day_order, matchDayForDate, экспорт isPseudoName.

## Задача 2: История как таблица плана (только портал клиента)
- `web/src/app/client/[token]/history/page.tsx` + `history-grid.tsx`:
  строки = упражнения (union по неделям, порядок первого появления), секции по дням;
  столбцы = все недели; ячейка = вес, подходыxповторы, RPE, коммент, дата (многострочно);
  план не показывается; skip -> бейдж «⏭ пропуск» (+причина) в строке дня для недели;
  матчинг логов: day_order если есть, иначе по имени в днях недели.

## Верификация
- Бот: npx tsc --noEmit + vitest (частичная != выполнено, skip != выполнено, rest-day не считается,
  case/trim, псевдо-строки, matchDayForDate).
- Веб: npx tsc --noEmit + next build.
- Quality gate: код-ревью >=9.5, TASKS.md, коммит+push (Render/Vercel автодеплой), бэкфилл после деплоя.
