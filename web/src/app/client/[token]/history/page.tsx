import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getParsedContent, flattenLoggableExercises, type ParsedDay } from "@/lib/program-utils";
import type { ClientRow } from "@/lib/clients";
import { getTodayDateStr } from "@/lib/date-utils";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { Card, CardContent } from "@/components/ui/card";
import { HistoryGrid } from "./history-grid";

type WorkoutLogRow = {
  date: string;
  week: number | null;
  day_order: number | null;
  exercise: string;
  sets: number | null;
  reps: string | null;
  weight: number | null;
  rpe: number | null;
  rounds: number | null;
  distance_km: number | null;
  duration_sec: number | null;
  heart_rate: number | null;
  pace: string | null;
  comment: string | null;
};

type ScheduleRow = {
  week_number: number;
  start_date: string | null;
  end_date: string | null;
};

const PSEUDO_EXERCISE = /^\[/;

function normalizeName(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isPseudoLog(log: WorkoutLogRow): boolean {
  return PSEUDO_EXERCISE.test(log.exercise ?? "");
}

function isSkipLog(log: WorkoutLogRow): boolean {
  return normalizeName(log.exercise).startsWith("[skip]");
}

export type HistoryEntry = {
  exercise: string;
  weight: number | null;
  sets: number | null;
  reps: string | null;
  rpe: number | null;
  rounds: number | null;
  distance_km: number | null;
  duration_sec: number | null;
  heart_rate: number | null;
  pace: string | null;
  comment: string | null;
  date: string;
};

export type HistoryCell = {
  entries: HistoryEntry[];
};

export type HistoryRow = {
  day_order: number;
  exercise: string;
  cells: Array<HistoryCell | null>;
};

export type HistoryDay = {
  day_order: number;
  day_name: string;
  focus: string | null;
  rows: HistoryRow[];
  skips: Array<string | null>;
};

function emptyCell(): HistoryCell {
  return { entries: [] };
}

function dayExerciseNames(day: ParsedDay | undefined): Set<string> {
  const names = new Set<string>();
  for (const ex of day?.exercises ?? []) {
    const normalized = normalizeName(ex.name);
    if (normalized) names.add(normalized);
  }
  return names;
}

function getIsoWeekday(dateStr: string): number {
  const date = new Date(`${dateStr}T12:00:00Z`);
  if (isNaN(date.getTime())) return 0;
  const iso = date.getUTCDay();
  return iso === 0 ? 7 : iso;
}

const DAY_NAME_TO_ISO: Record<string, number> = {
  понедельник: 1,
  вторник: 2,
  среда: 3,
  четверг: 4,
  пятница: 5,
  суббота: 6,
  воскресенье: 7,
};

function dayNameToIso(dayName: string): number {
  return DAY_NAME_TO_ISO[normalizeName(dayName)] ?? 0;
}

export default async function HistoryPage() {
  const h = await headers();
  const clientId = h.get("x-client-id");
  if (!clientId) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">История недоступна</p>
        </CardContent>
      </Card>
    );
  }

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("program_id, timezone, training_days")
    .eq("id", clientId)
    .maybeSingle<Pick<ClientRow, "program_id" | "timezone" | "training_days">>();

  if (!client?.program_id) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Программа не назначена</p>
        </CardContent>
      </Card>
    );
  }

  const { data: program } = await supabaseAdmin
    .from("programs")
    .select("*")
    .eq("id", client.program_id)
    .maybeSingle();

  const parsed = program ? getParsedContent(program) : null;
  if (!program || !parsed?.weeks?.length) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Нет данных по программе</p>
        </CardContent>
      </Card>
    );
  }

  const { data: schedule } = await supabaseAdmin
    .from("program_schedule")
    .select("week_number, start_date, end_date")
    .eq("client_id", clientId);
  const scheduleRows = (schedule ?? []) as ScheduleRow[];
  const trainingDays = client.training_days ?? [];

  const { data: logs, error: logsError } = await supabaseAdmin
    .from("workout_logs")
    .select("date, week, day_order, exercise, sets, reps, weight, rpe, rounds, distance_km, duration_sec, heart_rate, pace, comment")
    .eq("client_id", clientId)
    .order("date", { ascending: true })
    .order("created_at", { ascending: true });
  if (logsError) {
    console.error(`[HISTORY] Logs query failed for ${clientId}:`, logsError.message);
  }

  const weekCount = Math.max(
    program.duration_weeks ?? 0,
    ...parsed.weeks.map((w) => w.week_number),
  );
  if (!Number.isFinite(weekCount) || weekCount < 1) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Не удалось определить длительность программы</p>
        </CardContent>
      </Card>
    );
  }

  const dayRows = new Map<number, HistoryDay>();
  const weekNameSets = new Map<number, Map<number, Set<string>>>();

  for (const week of parsed.weeks) {
    const nameSets = new Map<number, Set<string>>();
    for (const day of week.days ?? []) {
      if (!day.exercises?.length) continue;

      const existingDay = dayRows.get(day.day_order);
      if (existingDay) {
        if (!existingDay.day_name && day.day_name) existingDay.day_name = day.day_name;
        if (!existingDay.focus && day.focus) existingDay.focus = day.focus;
      } else {
        dayRows.set(day.day_order, {
          day_order: day.day_order,
          day_name: day.day_name,
          focus: day.focus ?? null,
          rows: [],
          skips: Array.from({ length: weekCount }, () => null),
        });
      }

      const names = new Set<string>();
      for (const ex of flattenLoggableExercises(day.exercises ?? [])) {
        const name = normalizeName(ex.name);
        if (!name) continue;
        names.add(name);
        const historyDay = dayRows.get(day.day_order)!;
        if (!historyDay.rows.some((r) => normalizeName(r.exercise) === name)) {
          historyDay.rows.push({
            day_order: day.day_order,
            exercise: ex.name,
            cells: Array.from({ length: weekCount }, () => null),
          });
        }
      }
      nameSets.set(day.day_order, names);
    }
    if (nameSets.size > 0) weekNameSets.set(week.week_number, nameSets);
  }

  if (dayRows.size === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">В программе нет тренировочных дней</p>
        </CardContent>
      </Card>
    );
  }

  function weekForDate(date: string): number | null {
    const week = scheduleRows.find(
      (w) => w.start_date && w.end_date && date >= w.start_date && date <= w.end_date,
    );
    return week?.week_number ?? null;
  }

  const plannedDateToOrder = new Map<number, Map<string, number>>();
  for (const week of parsed.weeks) {
    const scheduleRow = scheduleRows.find((w) => w.week_number === week.week_number);
    if (!scheduleRow?.start_date) continue;
    const map = new Map<string, number>();
    for (const day of week.days ?? []) {
      const iso = dayNameToIso(day.day_name);
      if (iso < 1) continue;
      const date = new Date(`${scheduleRow.start_date}T12:00:00Z`);
      if (isNaN(date.getTime())) continue;
      date.setUTCDate(date.getUTCDate() + (iso - 1));
      map.set(date.toISOString().slice(0, 10), day.day_order);
    }
    if (map.size > 0) plannedDateToOrder.set(week.week_number, map);
  }

  for (const log of logs ?? []) {
    if (isPseudoLog(log) && !isSkipLog(log)) continue;

    let weekNumber = log.week;
    if (weekNumber == null) weekNumber = weekForDate(log.date);
    if (weekNumber == null || weekNumber < 1 || weekNumber > weekCount) continue;

    if (isSkipLog(log)) {
      let dayOrder = log.day_order;
      if (dayOrder == null && trainingDays.length > 0) {
        const iso = getIsoWeekday(log.date);
        const index = trainingDays.indexOf(iso);
        if (index !== -1) dayOrder = index + 1;
      }
      if (dayOrder == null) {
        dayOrder = plannedDateToOrder.get(weekNumber)?.get(log.date) ?? null;
      }
      const historyDay = dayOrder != null ? dayRows.get(dayOrder) : undefined;
      if (historyDay) {
        if (historyDay.skips[weekNumber - 1] == null) {
          historyDay.skips[weekNumber - 1] = log.comment?.trim() || "без причины";
        }
      }
      continue;
    }

    const name = normalizeName(log.exercise);
    const nameSetsForWeek = weekNameSets.get(weekNumber);
    const daysForWeek = parsed.weeks.find((w) => w.week_number === weekNumber)?.days ?? [];

    let historyDay: HistoryDay | undefined;
    if (log.day_order != null) {
      historyDay = dayRows.get(log.day_order);
      const names = nameSetsForWeek?.get(log.day_order);
      if (historyDay && names && !names.has(name)) historyDay = undefined;
    }
    if (!historyDay && nameSetsForWeek) {
      for (const [dayOrder, names] of nameSetsForWeek) {
        if (names.has(name)) {
          historyDay = dayRows.get(dayOrder);
          if (historyDay) break;
        }
      }
    }
    if (!historyDay) {
      const fallbackDay = daysForWeek.find((d) => dayExerciseNames(d).has(name));
      historyDay = fallbackDay ? dayRows.get(fallbackDay.day_order) : undefined;
    }
    if (!historyDay) continue;

    const historyRow = historyDay.rows.find((r) => normalizeName(r.exercise) === name);
    if (!historyRow) continue;

    const cell = (historyRow.cells[weekNumber - 1] ??= emptyCell());
    cell.entries.push({
      exercise: log.exercise as string,
      weight: log.weight,
      sets: log.sets,
      reps: log.reps,
      rpe: log.rpe,
      rounds: log.rounds,
      distance_km: log.distance_km,
      duration_sec: log.duration_sec,
      heart_rate: log.heart_rate,
      pace: log.pace,
      comment: log.comment,
      date: log.date,
    });
  }

  let todayStr: string;
  try {
    todayStr = getTodayDateStr(client.timezone || DEFAULT_TIMEZONE);
  } catch {
    todayStr = getTodayDateStr(DEFAULT_TIMEZONE);
  }
  let currentWeek: number | null = null;
  for (const w of scheduleRows) {
    if (!w.start_date || !w.end_date) continue;
    if (todayStr >= w.start_date && todayStr <= w.end_date) {
      currentWeek = w.week_number;
      break;
    }
  }

  const days: HistoryDay[] = [...dayRows.values()].sort((a, b) => a.day_order - b.day_order);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">История тренировок</h2>
        <p className="text-sm text-muted-foreground">
          Фактические результаты по неделям. Всего недель: {weekCount}
        </p>
      </div>
      {logsError && (
        <Card className="mb-4">
          <CardContent className="py-4 text-center text-destructive">
            Не удалось загрузить часть данных тренировок
          </CardContent>
        </Card>
      )}
      <HistoryGrid
        days={days}
        weekCount={weekCount}
        currentWeek={currentWeek}
      />
    </div>
  );
}
