import type { MyContext } from "../bot.js";
import { t, type Language } from "../i18n/index.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { getParsedContent, flattenLoggableExercises } from "../lib/program-utils.js";
import {
  getTodayDateStr,
  dayOrderForDate,
  plannedDateForDay,
} from "../lib/workout-utils.js";
import { DEFAULT_TIMEZONE } from "../lib/constants.js";

interface WorkoutLogRow {
  date: string;
  exercise: string;
  week: number | null;
  day_order: number | null;
  rpe: number | null;
}

interface ScheduleRow {
  week_number: number;
  start_date: string | null;
  end_date: string | null;
  is_deload: boolean;
  focus: string | null;
}

export async function myStatsHandler(ctx: MyContext): Promise<void> {
  const client = ctx.client;
  if (!client) {
    await ctx.reply(t("error.user_not_identified", ctx.language));
    return;
  }

  const lang = (client.language || "ru") as Language;
  const tz = client.timezone || DEFAULT_TIMEZONE;
  const todayStr = getTodayDateStr(tz);
  const monthStart = todayStr.slice(0, 7) + "-01";
  const monthLabel = todayStr.slice(0, 7);

  try {
    const { data, error } = await supabaseAdmin
      .from("workout_logs")
      .select("date, exercise, week, day_order, rpe")
      .eq("client_id", client.id)
      .gte("date", monthStart)
      .lte("date", todayStr)
      .order("date", { ascending: true });

    if (error) {
      console.error(`[MYSTATS] Failed to fetch stats for ${client.id}:`, error);
      await ctx.reply(t("error.service_unavailable", lang));
      return;
    }

    const rows = (data ?? []) as WorkoutLogRow[];

    if (rows.length === 0) {
      await ctx.reply(t("mystats.no_data", lang));
      return;
    }

    const plan = await getMonthWorkoutPlan(client, monthStart, todayStr);
    if (!plan) {
      await ctx.reply(t("mystats.no_data", lang));
      return;
    }

    const { completedCount, skippedCount, rpeValues } = countMonth(
      rows,
      plan,
      client.training_days,
    );

    const avgRpe = rpeValues.length > 0
      ? (rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length).toFixed(1)
      : null;

    const lines: string[] = [
      t("mystats.title", lang),
      t("mystats.month_label", lang, { month: monthLabel }),
      "",
      t("mystats.completed", lang, { count: String(completedCount) }),
      t("mystats.skipped", lang, { count: String(skippedCount) }),
      t("mystats.total_days", lang, { count: String(completedCount + skippedCount) }),
      avgRpe
        ? t("mystats.avg_rpe", lang, { rpe: avgRpe })
        : t("mystats.avg_rpe_none", lang),
    ];

    await ctx.reply(lines.join("\n"));
  } catch (err) {
    console.error(`[MYSTATS] Error for ${client.id}:`, err);
    await ctx.reply(t("error.service_unavailable", lang));
  }
}

async function getMonthWorkoutPlan(
  client: { id: string; program_id: string | null },
  monthStart: string,
  todayStr: string,
): Promise<{
  schedule: ScheduleRow[];
  weekDays: Map<number, Map<number, string[]>>;
  dayOrderByDate: Map<number, Map<string, number>>;
} | null> {
  if (!client.program_id) return null;

  const [{ data: schedule }, { data: program }] = await Promise.all([
    supabaseAdmin
      .from("program_schedule")
      .select("week_number, start_date, end_date, is_deload, focus")
      .eq("client_id", client.id),
    supabaseAdmin
      .from("programs")
      .select("parsed_content")
      .eq("id", client.program_id)
      .maybeSingle(),
  ]);

  const weekDays = new Map<number, Map<number, string[]>>();
  const dayOrderByDate = new Map<number, Map<string, number>>();
  const parsed = getParsedContent(program?.parsed_content ?? null);
  for (const week of parsed?.weeks ?? []) {
    const dayNames = new Map<number, string[]>();
    const datesForDay = new Map<string, number>();
    for (const day of week.days ?? []) {
      const names = flattenLoggableExercises(day.exercises ?? [])
        .map((ex) => ex.name?.trim().toLowerCase() ?? "")
        .filter(Boolean);
      if (names.length > 0) {
        dayNames.set(day.day_order, names);
        const scheduleRow = (schedule ?? []).find(
          (w) => w.week_number === week.week_number && w.start_date,
        );
        if (scheduleRow?.start_date) {
          const plannedDate = plannedDateForDay(scheduleRow.start_date, day.day_name);
          if (plannedDate) datesForDay.set(plannedDate, day.day_order);
        }
      }
    }
    if (dayNames.size > 0) weekDays.set(week.week_number, dayNames);
    if (datesForDay.size > 0) dayOrderByDate.set(week.week_number, datesForDay);
  }

  const overlapping: ScheduleRow[] = [];
  for (const week of (schedule ?? []) as ScheduleRow[]) {
    if (!week.start_date || !week.end_date) continue;
    if (week.end_date < monthStart || week.start_date > todayStr) continue;
    overlapping.push(week);
  }

  if (overlapping.length === 0) return null;
  return { schedule: overlapping, weekDays, dayOrderByDate };
}

function weekForDate(
  schedule: ScheduleRow[],
  date: string,
): ScheduleRow | null {
  return (
    schedule.find((w) => w.start_date && w.end_date && date >= w.start_date && date <= w.end_date) ??
    null
  );
}

export interface MonthPlan {
  schedule: ScheduleRow[];
  weekDays: Map<number, Map<number, string[]>>;
  dayOrderByDate: Map<number, Map<string, number>>;
}

export interface MonthCount {
  completedCount: number;
  skippedCount: number;
  rpeValues: number[];
}

export function countMonth(
  rows: WorkoutLogRow[],
  plan: MonthPlan,
  trainingDays: number[] | null,
): MonthCount {
  const dates = new Map<string, { logs: WorkoutLogRow[]; skip: boolean }>();

  for (const row of rows) {
    const entry = dates.get(row.date) ?? { logs: [], skip: false };
    entry.logs.push(row);
    if (row.exercise?.trim().toLowerCase().startsWith("[skip]")) entry.skip = true;
    dates.set(row.date, entry);
  }

  let completedCount = 0;
  let skippedCount = 0;
  const rpeValues: number[] = [];

  for (const [date, entry] of dates) {
    const week = weekForDate(plan.schedule, date);
    if (!week) continue;

    const storedOrders = new Set(
      entry.logs
        .map((l) => l.day_order)
        .filter((v): v is number => v != null),
    );
    const storedOrder = storedOrders.size === 1 ? [...storedOrders][0] : null;
    const usedOrder =
      storedOrder ??
      dayOrderForDate(date, trainingDays) ??
      plan.dayOrderByDate.get(week.week_number)?.get(date) ??
      null;

    if (usedOrder != null) {
      const plannedNames = plan.weekDays.get(week.week_number)?.get(usedOrder) ?? [];
      if (plannedNames.length === 0) continue;

      if (entry.skip && !isCompleted(entry.logs, plannedNames)) {
        skippedCount++;
        continue;
      }

      if (isCompleted(entry.logs, plannedNames)) {
        completedCount++;
        for (const row of entry.logs) {
          if (!row.exercise?.trim().startsWith("[") && row.rpe != null) {
            rpeValues.push(row.rpe);
          }
        }
      }
    }
  }

  return { completedCount, skippedCount, rpeValues };
}

function isCompleted(
  logs: WorkoutLogRow[],
  plannedNames: string[],
): boolean {
  if (plannedNames.length === 0) return false;
  const loggedNames = new Set(
    logs
      .map((l) => l.exercise?.trim().toLowerCase())
      .filter((name): name is string => Boolean(name) && !name.startsWith("[")),
  );
  return plannedNames.every((name) => loggedNames.has(name));
}
