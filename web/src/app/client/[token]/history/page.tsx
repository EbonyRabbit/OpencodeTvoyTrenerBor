import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getParsedContent, type ParsedDay } from "@/lib/program-utils";
import type { ClientRow } from "@/lib/clients";
import { getTodayDateStr } from "@/lib/date-utils";
import { Card, CardContent } from "@/components/ui/card";
import { HistoryGrid } from "./history-grid";

const DEFAULT_TIMEZONE = "Europe/Moscow";

type WorkoutLogRow = {
  week: number | null;
  exercise: string | null;
  sets: number | null;
  reps: string | null;
  weight: number | null;
};

const PSEUDO_EXERCISE = /^\[/;

function normalizeName(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isPseudoLog(log: WorkoutLogRow): boolean {
  const name = log.exercise ?? "";
  return PSEUDO_EXERCISE.test(name.trim());
}

function isRealLog(log: WorkoutLogRow): boolean {
  return !isPseudoLog(log) && normalizeName(log.exercise) !== "";
}

function dayExerciseNames(day: ParsedDay | undefined): Set<string> {
  const names = new Set<string>();
  for (const ex of day?.exercises ?? []) {
    const normalized = normalizeName(ex.name);
    if (normalized) names.add(normalized);
  }
  return names;
}

export type HistoryCell = {
  logs: Array<{
    exercise: string;
    weight: number | null;
    sets: number | null;
    reps: string | null;
  }>;
};

export type HistoryRow = {
  day_order: number;
  day_name: string;
  focus: string | null;
  cells: Array<HistoryCell | null>;
};

function emptyCell(): HistoryCell {
  return { logs: [] };
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
    .select("program_id, timezone")
    .eq("id", clientId)
    .maybeSingle<Pick<ClientRow, "program_id" | "timezone">>();

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

  const { data: logs, error: logsError } = await supabaseAdmin
    .from("workout_logs")
    .select("week, exercise, sets, reps, weight")
    .eq("client_id", clientId);
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

  const firstWeekWithDays = parsed.weeks.find((w) => w.days?.length);
  const canonicalDays = firstWeekWithDays?.days ?? [];
  if (canonicalDays.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">В программе нет тренировочных дней</p>
        </CardContent>
      </Card>
    );
  }

  const weekDays = new Map<number, ParsedDay[]>();
  for (const week of parsed.weeks) {
    weekDays.set(week.week_number, week.days ?? []);
  }

  const rows: HistoryRow[] = canonicalDays.map((day) => ({
    day_order: day.day_order,
    day_name: day.day_name,
    focus: day.focus ?? null,
    cells: Array.from({ length: weekCount }, () => null),
  }));

  for (const log of logs ?? []) {
    if (!isRealLog(log)) continue;
    if (log.week == null || log.week < 1 || log.week > weekCount) continue;

    const name = normalizeName(log.exercise);
    const daysForWeek = weekDays.get(log.week) ?? canonicalDays;
    for (const row of rows) {
      const dayForWeek = daysForWeek.find((d) => d.day_order === row.day_order);
      const names = dayExerciseNames(dayForWeek ?? dayByOrder(canonicalDays, row.day_order));
      if (!names.has(name)) continue;
      const cell = (row.cells[log.week - 1] ??= emptyCell());
      cell.logs.push({
        exercise: log.exercise as string,
        weight: log.weight,
        sets: log.sets,
        reps: log.reps,
      });
      break;
    }
  }

  const { data: schedule } = await supabaseAdmin
    .from("program_schedule")
    .select("week_number, start_date, end_date")
    .eq("client_id", clientId);

  let todayStr: string;
  try {
    todayStr = getTodayDateStr(client.timezone || DEFAULT_TIMEZONE);
  } catch {
    todayStr = getTodayDateStr(DEFAULT_TIMEZONE);
  }
  let currentWeek: number | null = null;
  for (const w of schedule ?? []) {
    if (!w.start_date || !w.end_date) continue;
    if (todayStr >= w.start_date && todayStr <= w.end_date) {
      currentWeek = w.week_number;
      break;
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">История тренировок</h2>
        <p className="text-sm text-muted-foreground">
          Сделанные тренировки по неделям. Всего недель: {weekCount}
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
        rows={rows}
        weekCount={weekCount}
        currentWeek={currentWeek}
      />
    </div>
  );
}

function dayByOrder(days: ParsedDay[], dayOrder: number): ParsedDay | undefined {
  return days.find((d) => d.day_order === dayOrder);
}
