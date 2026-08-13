import type { ParsedContent } from "./program-utils";
import type { WorkoutLog } from "./adherence";
import {
  getPlannedDayNames,
  isCompletedDay,
  isRealExercise,
  collectDayOrderLogs,
  isDayCompletedByOrder,
} from "./adherence";
import { weekdayDateInWeek } from "./week-days";
import { weekdayIsoFromName } from "./day-names";

export type ScheduleWeek = {
  week_number: number;
  start_date: string | null;
  end_date: string | null;
  training_days?: number[] | null;
};

export type NextWorkoutDay = {
  date: string;
  iso: number;
  weekNumber: number;
  isToday: boolean;
};

function parseUTCDate(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00Z`);
}

function isoDayOfUTC(date: Date): number {
  return date.getUTCDay() === 0 ? 7 : date.getUTCDay();
}

function addDays(dateStr: string, days: number): string {
  const d = parseUTCDate(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function hasTrainedOnDate(workoutLogs: WorkoutLog[], date: string): boolean {
  return workoutLogs.some((l) => l.date === date && isRealExercise(l.exercise));
}

export function getNextWorkoutDay({
  schedule,
  clientTrainingDays,
  parsed,
  workoutLogs,
  today,
}: {
  schedule: ScheduleWeek[];
  clientTrainingDays: number[] | null;
  parsed: ParsedContent | null;
  workoutLogs: WorkoutLog[];
  today: string;
}): NextWorkoutDay | null {
  const weeks = schedule.filter(
    (w): w is ScheduleWeek & { start_date: string; end_date: string } =>
      !!w.start_date && !!w.end_date && w.start_date <= w.end_date,
  );
  if (weeks.length === 0) return null;

  if (Number.isNaN(parseUTCDate(today).getTime())) return null;

  const logsByDate = new Map<string, WorkoutLog[]>();
  for (const log of workoutLogs) {
    const existing = logsByDate.get(log.date);
    if (existing) existing.push(log);
    else logsByDate.set(log.date, [log]);
  }

  let startIndex = weeks.findIndex(
    (w) => w.start_date <= today && w.end_date >= today,
  );
  if (startIndex === -1) {
    const nextIndex = weeks.findIndex((w) => w.start_date > today);
    if (nextIndex === -1) return null;
    startIndex = nextIndex;
  }

  for (let i = startIndex; i < weeks.length; i++) {
    const week = weeks[i];
    const trainingDays = week.training_days ?? clientTrainingDays;

    if (trainingDays && trainingDays.length > 0) {
      const found = nextByTrainingDays(
        week,
        trainingDays,
        i === startIndex ? today : week.start_date,
        today,
        parsed,
        logsByDate,
      );
      if (found) return found;
    } else {
      const found = nextByDayOrder(
        week,
        i === startIndex ? today : week.start_date,
        today,
        parsed,
        logsByDate,
      );
      if (found) return found;
    }
  }

  return null;
}

function nextByTrainingDays(
  week: ScheduleWeek & { start_date: string; end_date: string },
  trainingDays: number[],
  startDate: string,
  today: string,
  parsed: ParsedContent | null,
  logsByDate: Map<string, WorkoutLog[]>,
): NextWorkoutDay | null {
  const endMs = parseUTCDate(week.end_date).getTime();
  let cursor = startDate < week.start_date ? week.start_date : startDate;
  if (cursor > week.end_date) return null;

  while (parseUTCDate(cursor).getTime() <= endMs) {
    const date = parseUTCDate(cursor);
    const iso = isoDayOfUTC(date);
    const dayIdx = trainingDays.indexOf(iso);
    if (dayIdx !== -1) {
      const plannedNames = getPlannedDayNames(parsed, week.week_number, dayIdx + 1);
      const logs = logsByDate.get(cursor) ?? [];
      if (plannedNames.length > 0 && !isCompletedDay(logs, plannedNames)) {
        return { date: cursor, iso, weekNumber: week.week_number, isToday: cursor === today };
      }
    }
    cursor = addDays(cursor, 1);
  }

  return null;
}

function nextByDayOrder(
  week: ScheduleWeek & { start_date: string; end_date: string },
  startDate: string,
  today: string,
  parsed: ParsedContent | null,
  logsByDate: Map<string, WorkoutLog[]>,
): NextWorkoutDay | null {
  const weekDays =
    parsed?.weeks?.find((w) => w.week_number === week.week_number)?.days ?? [];
  const orderedDays = [...weekDays]
    .filter((d) => !!d.exercises?.length)
    .sort((a, b) => a.day_order - b.day_order);

  const { byOrder, byDate } = collectDayOrderLogs(
    logsByDate,
    week.start_date,
    week.end_date,
    today,
    true,
  );

  const seenDates = new Set<number>();
  for (const day of orderedDays) {
    const iso = weekdayIsoFromName(day.day_name);
    if (iso < 1) continue;
    const date = weekdayDateInWeek(week.start_date, week.end_date, iso);
    if (!date) continue;

    const dateMs = parseUTCDate(date).getTime();
    if (seenDates.has(dateMs)) continue;
    seenDates.add(dateMs);

    if (date < startDate) continue;

    const plannedNames = getPlannedDayNames(parsed, week.week_number, day.day_order);
    if (plannedNames.length === 0) continue;

    if (isDayCompletedByOrder(byOrder, byDate, day, week.start_date, week.end_date, plannedNames)) {
      continue;
    }

    return { date, iso, weekNumber: week.week_number, isToday: date === today };
  }

  return null;
}