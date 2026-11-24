import Link from "next/link";
import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getParsedContent, flattenLoggableExercises, getCompositeLetters, type ParsedDay, type ParsedExercise } from "@/lib/program-utils";
import type { HistoryEntry } from "@/lib/history-format";
import type { ClientRow } from "@/lib/clients";
import { getTodayDateStr } from "@/lib/date-utils";
import { weekdayDateInWeek } from "@/lib/week-days";
import { weekdayIsoFromName } from "@/lib/day-names";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { listProgramPeriods } from "@/lib/program-periods";
import {
  formatPeriodLabel,
  resolveHistorySelection,
  type HistoryPeriodOption,
  type HistorySelection,
} from "@/lib/history-periods";
import { Card, CardContent } from "@/components/ui/card";
import { HistoryGrid } from "./history-grid";
import { HistoryAllList, type HistoryAllLog } from "./history-all-list";

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
  pace: string | null;
  comment: string | null;
};

type ScheduleRow = {
  week_number: number;
  start_date: string | null;
  end_date: string | null;
  training_days: number[] | null;
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

export type HistoryCell = {
  entries: HistoryEntry[];
};

export type HistoryRow = {
  day_order: number;
  exercise: string;
  children: ParsedExercise[];
  compositeLetter: string | null;
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

function HistoryPeriodSelector({
  periods,
  selection,
}: {
  periods: HistoryPeriodOption[];
  selection: HistorySelection;
}) {
  const baseClass = "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors";
  const activeClass = "border-primary bg-primary text-primary-foreground";
  const inactiveClass = "border-border bg-card text-muted-foreground hover:text-foreground";
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <Link
        href="?period=all"
        className={`${baseClass} ${selection.mode === "all" ? activeClass : inactiveClass}`}
      >
        Все тренировки
      </Link>
      {periods.map((period, index) => (
        <Link
          key={period.id}
          href={`?period=${encodeURIComponent(period.id)}`}
          className={`${baseClass} ${selection.mode === "period" && selection.periodId === period.id ? activeClass : inactiveClass}`}
        >
          {formatPeriodLabel(period) || `Период ${index + 1}`}
        </Link>
      ))}
    </div>
  );
}

function getIsoWeekday(dateStr: string): number {
  const date = new Date(`${dateStr}T12:00:00Z`);
  if (isNaN(date.getTime())) return 0;
  const iso = date.getUTCDay();
  return iso === 0 ? 7 : iso;
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string | string[] | undefined }>;
}) {
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

  if (!client) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Клиент не найден</p>
        </CardContent>
      </Card>
    );
  }

  const { periods, error: periodsError } = await listProgramPeriods(clientId);
  if (periodsError) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Не удалось загрузить периоды тренировок</p>
        </CardContent>
      </Card>
    );
  }
  const activePeriod = periods.find((period) => period.status === "active") ?? null;
  const query = await searchParams;
  const selection = resolveHistorySelection(query.period, periods, activePeriod?.id ?? null);
  const selector = <HistoryPeriodSelector periods={periods} selection={selection} />;

  if (selection.mode === "all") {
    const { data: allLogs, error: allLogsError } = await supabaseAdmin
      .from("workout_logs")
      .select("date, week, day_order, exercise, sets, reps, weight, rpe, rounds, distance_km, duration_sec, pace, comment, program_period_id, created_at")
      .eq("client_id", clientId)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(2001);
    if (allLogsError) {
      console.error(`[HISTORY] All logs query failed for ${clientId}:`, allLogsError.message);
    }
    return (
      <div>
        <div className="mb-4">
          <h2 className="text-lg font-semibold">История тренировок</h2>
          <p className="text-sm text-muted-foreground">Все периоды в одном списке</p>
        </div>
        {selector}
        {allLogsError && (
          <Card className="mb-4">
            <CardContent className="py-4 text-center text-destructive">
              Не удалось загрузить часть данных тренировок
            </CardContent>
          </Card>
        )}
        <HistoryAllList
          logs={((allLogs ?? []) as HistoryAllLog[]).slice(0, 2000)}
          periods={periods}
          truncated={(allLogs?.length ?? 0) > 2000}
        />
      </div>
    );
  }

  const selectedPeriod = periods.find((period) => period.id === selection.periodId) ?? null;
  const programId =
    selectedPeriod?.programId ?? (selection.periodId === null ? client.program_id : null);
  if (!programId) {
    return (
      <div>
        {selector}
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">Программа не назначена</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { data: program } = await supabaseAdmin
    .from("programs")
    .select("*")
    .eq("id", programId)
    .maybeSingle();

  const parsed = program ? getParsedContent(program) : null;
  if (!program || !parsed?.weeks?.length) {
    return (
      <div>
        {selector}
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">Нет данных по программе</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const historyScheduleQuery = supabaseAdmin
    .from("program_schedule")
    .select("week_number, start_date, end_date, training_days")
    .eq("client_id", clientId);
  const { data: schedule } = await (selection.periodId
    ? historyScheduleQuery.eq("program_period_id", selection.periodId)
    : historyScheduleQuery
  );
  const scheduleRows = (schedule ?? []) as ScheduleRow[];
  const trainingDays = client.training_days ?? [];

  let historyLogsQuery = supabaseAdmin
    .from("workout_logs")
    .select("date, week, day_order, exercise, sets, reps, weight, rpe, rounds, distance_km, duration_sec, pace, comment")
    .eq("client_id", clientId);
  if (selection.periodId) {
    historyLogsQuery = historyLogsQuery.eq("program_period_id", selection.periodId);
  }
  const { data: logs, error: logsError } = await historyLogsQuery
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
      const circuitLetters = new Map<string, string>();
      const compositeLetters = getCompositeLetters(day.exercises ?? []);
      (day.exercises ?? []).forEach((ex, i) => {
        if (ex.type === "circuit") {
          const n = normalizeName(ex.name);
          if (n) circuitLetters.set(n, compositeLetters.get(i) ?? "A");
        }
      });
      for (const ex of flattenLoggableExercises(day.exercises ?? [])) {
        const name = normalizeName(ex.name);
        if (!name) continue;
        names.add(name);
        const historyDay = dayRows.get(day.day_order)!;
        if (!historyDay.rows.some((r) => normalizeName(r.exercise) === name)) {
          historyDay.rows.push({
            day_order: day.day_order,
            exercise: ex.name,
            children: ex.type === "circuit" ? (ex.children ?? []) : [],
            compositeLetter: ex.type === "circuit" ? (circuitLetters.get(name) ?? null) : null,
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

  function weekRowForDate(date: string): ScheduleRow | null {
    return (
      scheduleRows.find(
        (w) => w.start_date && w.end_date && date >= w.start_date && date <= w.end_date,
      ) ?? null
    );
  }

  const plannedDateToOrder = new Map<number, Map<string, number>>();
  for (const week of parsed.weeks) {
    const scheduleRow = scheduleRows.find((w) => w.week_number === week.week_number);
    if (!scheduleRow?.start_date) continue;
    const map = new Map<string, number>();
    for (const day of week.days ?? []) {
      const iso = weekdayIsoFromName(day.day_name);
      if (iso < 1) continue;
      const plannedDate = weekdayDateInWeek(
        scheduleRow.start_date,
        scheduleRow.end_date,
        iso,
      );
      if (plannedDate) map.set(plannedDate, day.day_order);
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
      if (dayOrder == null) {
        const weekRow = weekRowForDate(log.date);
        const weekDays = weekRow?.training_days ?? trainingDays;
        if (weekDays.length > 0) {
          const iso = getIsoWeekday(log.date);
          const index = weekDays.indexOf(iso);
          if (index !== -1) dayOrder = index + 1;
        }
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
      {selector}
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
