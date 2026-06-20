import type { ParsedContent } from "./program-utils";

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

function getExpectedWorkouts(parsed: ParsedContent | null, weekNumber: number): number {
  if (!parsed?.weeks) return 0;
  const week = parsed.weeks.find((w) => w.week_number === weekNumber);
  if (!week?.days) return 0;
  return week.days.filter((d) => (d.exercises?.length ?? 0) > 0).length;
}

function getCompletedWorkouts(
  workoutDates: Set<string>,
  startDate: string,
  endDate: string,
): number {
  let count = 0;
  for (const date of workoutDates) {
    if (date >= startDate && date <= endDate) {
      count++;
    }
  }
  return count;
}

function isPastOrCurrent(endDate: string): boolean {
  try {
    const end = new Date(endDate);
    if (isNaN(end.getTime())) return false;
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return end <= today;
  } catch {
    return false;
  }
}

export function calculateAdherence(
  schedule: {
    week_number: number;
    start_date: string | null;
    end_date: string | null;
    focus: string | null;
  }[],
  parsed: ParsedContent | null,
  workoutLogs: { date: string }[],
): AdherenceResult {
  const uniqueDates = new Set(workoutLogs.map((l) => l.date));

  const weeks: WeekAdherence[] = [];
  let totalCompleted = 0;
  let totalExpected = 0;

  for (const week of schedule) {
    if (!week.start_date || !week.end_date) continue;
    if (!isPastOrCurrent(week.end_date)) continue;

    const expected = getExpectedWorkouts(parsed, week.week_number);
    if (expected === 0) continue;

    const completed = getCompletedWorkouts(uniqueDates, week.start_date, week.end_date);
    const adherencePct = Math.min(Math.round((completed / expected) * 100), 100);

    totalCompleted += completed;
    totalExpected += expected;

    const weekLabel = parsed?.weeks?.find(
      (w) => w.week_number === week.week_number,
    )?.week_label ?? `Неделя ${week.week_number}`;

    weeks.push({
      weekNumber: week.week_number,
      weekLabel,
      startDate: week.start_date,
      endDate: week.end_date,
      focus: week.focus,
      expected,
      completed,
      adherencePct,
    });
  }

  const overallAdherence =
    totalExpected > 0
      ? Math.min(Math.round((totalCompleted / totalExpected) * 100), 100)
      : null;

  return { weeks, overallAdherence, totalCompleted, totalExpected };
}

export function getAdherenceColor(pct: number | null): string {
  if (pct === null) return "text-muted-foreground";
  if (pct >= 80) return "text-green-600";
  if (pct >= 50) return "text-yellow-600";
  return "text-red-600";
}
