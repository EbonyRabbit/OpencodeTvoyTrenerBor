import type { ParsedContent } from "./program-utils";
import { weekdayDateInWeek } from "./week-days";
import { weekdayIsoFromName } from "./day-names";

export type WeekAdherence = {
  weekNumber: number;
  weekLabel: string;
  startDate: string;
  endDate: string;
  focus: string | null;
  expected: number;
  completed: number;
  adherencePct: number;
};

export type AdherenceResult = {
  weeks: WeekAdherence[];
  overallAdherence: number | null;
  totalCompleted: number;
  totalExpected: number;
};

export type WorkoutLog = {
  date: string;
  exercise?: string | null;
  week?: number | null;
  day_order?: number | null;
};

const PSEUDO_EXERCISE = /^\[/;

function normalizeName(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function isRealExercise(value: string | null | undefined): boolean {
  const name = normalizeName(value);
  return name !== "" && !PSEUDO_EXERCISE.test(name);
}

export function getPlannedDayNames(
  parsed: ParsedContent | null,
  weekNumber: number,
  dayOrder: number,
): string[] {
  const week = parsed?.weeks?.find((w) => w.week_number === weekNumber);
  const day = week?.days?.find((d) => d.day_order === dayOrder);
  if (!day?.exercises?.length) return [];
  return day.exercises.map((ex) => normalizeName(ex.name)).filter(isRealExercise);
}

export function isCompletedDay(
  logsOnDate: WorkoutLog[],
  plannedNames: string[],
): boolean {
  const loggedNames = new Set(
    logsOnDate
      .map((l) => normalizeName(l.exercise))
      .filter(isRealExercise),
  );
  return plannedNames.every((name) => loggedNames.has(name));
}

function plannedDateForDay(
  weekStartDate: string,
  weekEndDate: string,
  dayName: string,
): string | null {
  const iso = weekdayIsoFromName(dayName);
  if (iso < 1) return null;
  return weekdayDateInWeek(weekStartDate, weekEndDate, iso);
}

export function calculateAdherence(
  schedule: {
    week_number: number;
    start_date: string | null;
    end_date: string | null;
    focus: string | null;
    training_days?: number[] | null;
  }[],
  parsed: ParsedContent | null,
  workoutLogs: WorkoutLog[],
  trainingDays: number[] | null,
  today: string,
): AdherenceResult {
  const logsByDate = new Map<string, WorkoutLog[]>();
  for (const log of workoutLogs) {
    const existing = logsByDate.get(log.date);
    if (existing) existing.push(log);
    else logsByDate.set(log.date, [log]);
  }

  const weeks: WeekAdherence[] = [];
  let totalCompleted = 0;
  let totalExpected = 0;

  for (const week of schedule) {
    if (!week.start_date || !week.end_date) continue;
    if (week.start_date > today) continue;

    const weekDates = {
      week_number: week.week_number,
      start_date: week.start_date,
      end_date: week.end_date,
    };
    const weekTrainingDays = week.training_days ?? trainingDays;
    const weekLog = weekTrainingDays && weekTrainingDays.length > 0
      ? countWeekByDates(parsed, weekDates, today, weekTrainingDays, logsByDate)
      : countWeekByDayOrder(parsed, weekDates, today, logsByDate);
    if (weekLog.expected === 0) continue;

    const adherencePct = Math.min(Math.round((weekLog.completed / weekLog.expected) * 100), 100);

    totalCompleted += weekLog.completed;
    totalExpected += weekLog.expected;

    const weekLabel = parsed?.weeks?.find(
      (w) => w.week_number === week.week_number,
    )?.week_label ?? `Неделя ${week.week_number}`;

    weeks.push({
      weekNumber: week.week_number,
      weekLabel,
      startDate: week.start_date,
      endDate: week.end_date,
      focus: week.focus,
      expected: weekLog.expected,
      completed: weekLog.completed,
      adherencePct,
    });
  }

  const overallAdherence =
    totalExpected > 0
      ? Math.min(Math.round((totalCompleted / totalExpected) * 100), 100)
      : null;

  return { weeks, overallAdherence, totalCompleted, totalExpected };
}

function countWeekByDates(
  parsed: ParsedContent | null,
  week: { week_number: number; start_date: string; end_date: string },
  today: string,
  trainingDays: number[],
  logsByDate: Map<string, WorkoutLog[]>,
): { expected: number; completed: number } {
  let expected = 0;

  const lastDate = week.end_date < today ? week.end_date : today;
  const cursor = new Date(`${week.start_date}T12:00:00Z`);
  const last = new Date(`${lastDate}T12:00:00Z`);

  for (; cursor <= last; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const iso = cursor.getUTCDay() === 0 ? 7 : cursor.getUTCDay();
    const index = trainingDays.indexOf(iso);
    if (index === -1) continue;
    const dayOrder = index + 1;
    const plannedNames = getPlannedDayNames(parsed, week.week_number, dayOrder);
    if (plannedNames.length === 0) continue;
    expected++;
  }

  return { expected, completed: countTrainedDays(week.start_date, week.end_date, today, logsByDate) };
}

// Считает, сколько дней в рамках недели (до today) клиент реально
// тренировался: в логе есть хотя бы одно реальное упражнение. Тренировки
// вне плановых дат («не по плану») тоже засчитываются.
function countTrainedDays(
  weekStart: string,
  weekEnd: string,
  today: string,
  logsByDate: Map<string, WorkoutLog[]>,
): number {
  const lastDate = weekEnd < today ? weekEnd : today;
  const cursor = new Date(`${weekStart}T12:00:00Z`);
  const last = new Date(`${lastDate}T12:00:00Z`);
  let trained = 0;

  for (; cursor <= last; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const logs = logsByDate.get(dateStr) ?? [];
    if (logs.some((l) => isRealExercise(l.exercise))) trained++;
  }

  return trained;
}

export function collectDayOrderLogs(
  logsByDate: Map<string, WorkoutLog[]>,
  weekStart: string,
  weekEnd: string,
  today: string,
  includeFuture: boolean,
): { byOrder: Map<number, WorkoutLog[]>; byDate: Map<string, WorkoutLog[]> } {
  const byOrder = new Map<number, WorkoutLog[]>();
  const byDate = new Map<string, WorkoutLog[]>();

  for (const [dateStr, logs] of logsByDate) {
    if (dateStr < weekStart || dateStr > weekEnd) continue;
    if (!includeFuture && dateStr > today) continue;
    byDate.set(dateStr, logs);
    for (const log of logs) {
      if (log.day_order == null) continue;
      const existing = byOrder.get(log.day_order);
      if (existing) existing.push(log);
      else byOrder.set(log.day_order, [log]);
    }
  }

  return { byOrder, byDate };
}

export function isDayCompletedByOrder(
  byOrder: Map<number, WorkoutLog[]>,
  byDate: Map<string, WorkoutLog[]>,
  day: { day_order: number; day_name: string },
  weekStart: string,
  weekEnd: string,
  plannedNames: string[],
): boolean {
  const byOrderLogs = byOrder.get(day.day_order) ?? [];
  const plannedDate = plannedDateForDay(weekStart, weekEnd, day.day_name);
  const byDateLogs =
    plannedDate != null
      ? (byDate.get(plannedDate) ?? []).filter(
          (l) => l.day_order == null || l.day_order === day.day_order,
        )
      : [];
  return isCompletedDay(byOrderLogs.concat(byDateLogs), plannedNames);
}

function countWeekByDayOrder(
  parsed: ParsedContent | null,
  week: { week_number: number; start_date: string; end_date: string },
  today: string,
  logsByDate: Map<string, WorkoutLog[]>,
): { expected: number; completed: number } {
  let expected = 0;

  const weekDays = parsed?.weeks?.find((w) => w.week_number === week.week_number)?.days ?? [];

  for (const day of weekDays) {
    if (!day.exercises?.length) continue;
    const plannedNames = day.exercises.map((ex) => normalizeName(ex.name)).filter(isRealExercise);
    if (plannedNames.length === 0) continue;

    const plannedDate = plannedDateForDay(week.start_date, week.end_date, day.day_name);
    if (plannedDate != null && plannedDate > today) continue;

    expected++;
  }

  return { expected, completed: countTrainedDays(week.start_date, week.end_date, today, logsByDate) };
}

export function getAdherenceColor(pct: number | null): string {
  if (pct === null) return "text-muted-foreground";
  if (pct >= 80) return "text-green-600";
  if (pct >= 50) return "text-yellow-600";
  return "text-red-600";
}
