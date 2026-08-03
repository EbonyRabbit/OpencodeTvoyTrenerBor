import { supabaseAdmin } from "./supabase-admin.js";
import type { Client } from "./clients.js";
import { getParsedContent, type ParsedExercise, type ParsedDay } from "./program-utils.js";
import { t, type Language } from "../i18n/index.js";
import { DEFAULT_TIMEZONE } from "./constants.js";

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export interface WorkoutPlan {
  week_number: number;
  is_deload: boolean;
  goal: string | null;
  days: ParsedDay[];
}

export type TodayWorkout = WorkoutPlan & {
  day_name: string;
  exercises: ParsedExercise[];
};

interface WorkoutSender {
  reply: (text: string, options?: Record<string, unknown>) => Promise<unknown>;
  language: Language;
}

function getTodayDayName(timezone: string): string {
  const formatter = new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    timeZone: timezone,
  });
  return formatter.format(new Date()).toLowerCase();
}

export function getTodayDateStr(timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
  });
  return formatter.format(new Date());
}

export async function getWorkoutPlan(
  client: Client,
  scheduleWeek: number,
  scheduleContext?: { is_deload: boolean; focus: string | null },
): Promise<WorkoutPlan | null> {
  if (!client.program_id) return null;

  let scheduleData = scheduleContext;

  if (!scheduleData) {
    const { data, error } = await supabaseAdmin
      .from("program_schedule")
      .select("is_deload, focus")
      .eq("client_id", client.id)
      .eq("week_number", scheduleWeek)
      .maybeSingle();

    if (error) {
      console.error(`[WORKOUT] Schedule query error for ${client.id}:`, error.message);
      return null;
    }

    if (!data) return null;
    scheduleData = data;
  }

  const { data: program, error: programError } = await supabaseAdmin
    .from("programs")
    .select("parsed_content")
    .eq("id", client.program_id)
    .maybeSingle();

  if (programError) {
    console.error(`[WORKOUT] Program query error for ${client.id}:`, programError.message);
    return null;
  }

  const parsed = getParsedContent(program?.parsed_content ?? null);
  if (!parsed) return null;

  const weekData = parsed.weeks?.find((w) => w.week_number === scheduleWeek);
  if (!weekData?.days) return null;

  return {
    week_number: scheduleWeek,
    is_deload: scheduleData.is_deload,
    goal: scheduleData.focus,
    days: weekData.days,
  };
}

function getTodayISODay(timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: timezone,
  });
  const dayName = formatter.format(new Date()).toLowerCase();
  const dayMap: Record<string, number> = {
    monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
    friday: 5, saturday: 6, sunday: 7,
  };
  return dayMap[dayName] ?? 0;
}

function weekdayFullName(iso: number, lang: Language): string {
  return t(`schedule.day_fullnames.${String(iso)}`, lang);
}

export async function getTodayWorkout(client: Client, lang: Language = "ru"): Promise<TodayWorkout | null> {
  if (!client.program_id) return null;

  const tz = client.timezone || DEFAULT_TIMEZONE;
  const todayName = getTodayDayName(tz);
  const todayStr = getTodayDateStr(tz);

  const { data: schedule, error: scheduleError } = await supabaseAdmin
    .from("program_schedule")
    .select("week_number, start_date, end_date, is_deload, focus")
    .eq("client_id", client.id);

  if (scheduleError) {
    console.error(`[WORKOUT] Schedule query error for ${client.id}:`, scheduleError.message);
    return null;
  }

  const currentWeekRow = (schedule ?? []).find((w) => {
    if (!w.start_date || !w.end_date) return false;
    return todayStr >= w.start_date && todayStr <= w.end_date;
  });

  if (!currentWeekRow) return null;

  const plan = await getWorkoutPlan(client, currentWeekRow.week_number, {
    is_deload: currentWeekRow.is_deload,
    focus: currentWeekRow.focus,
  });
  if (!plan) return null;

  const matchedDay = matchDayForToday(plan.days, client.training_days, todayName, tz);

  if (!matchedDay?.exercises?.length) return null;

  const scheduledIsoDay =
    (client.training_days?.length ?? 0) > 0 ? getTodayISODay(tz) : null;

  return {
    ...plan,
    day_name: scheduledIsoDay ? weekdayFullName(scheduledIsoDay, lang) : matchedDay.day_name,
    goal: matchedDay.focus ?? null,
    exercises: matchedDay.exercises,
  };
}

function matchDayForToday(
  days: ParsedDay[],
  trainingDays: number[] | null,
  todayName: string,
  tz: string,
): ParsedDay | null {
  if (trainingDays && trainingDays.length > 0) {
    const todayISO = getTodayISODay(tz);
    const dayIndex = trainingDays.indexOf(todayISO);
    if (dayIndex === -1) return null;
    const dayOrder = dayIndex + 1;
    const matched = days.find((d) => d.day_order === dayOrder);
    if (matched) return matched;
  }

  return days.find((d) => {
    const normalizedName = d.day_name.toLowerCase();
    return normalizedName.includes(todayName);
  }) ?? null;
}

function formatExerciseDetailLine(ex: ParsedExercise): string {
  const parts: string[] = [];
  if (ex.sets && ex.reps) parts.push(`${ex.sets}×${ex.reps}`);
  if (ex.weight) parts.push(ex.weight);
  if (ex.rpe) parts.push(`RPE ${ex.rpe}`);
  if (parts.length === 0) return "";
  return `   ${parts.join(", ")}`;
}

export interface PreviousLog {
  weight: number | null;
  sets: number | null;
  reps: string | null;
}

const PSEUDO_EXERCISE = /^\[/;

function isPseudoName(name: string): boolean {
  return PSEUDO_EXERCISE.test(name.trim());
}

function escapeLikeValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/\*/g, "\\*");
}

function postgrestValue(value: string): string {
  if (/[(),"]/.test(value)) {
    const doubled = value.replace(/\\/g, "\\\\");
    return `"${doubled.replace(/"/g, '\\"')}"`;
  }
  return escapeLikeValue(value);
}

const LAST_LOGS_CACHE_TTL_MS = 30_000;
const LAST_LOGS_CACHE_MAX_SIZE = 100;
const lastLogsCache = new Map<string, { at: number; value: Map<string, PreviousLog> }>();

function cacheKey(clientId: string, names: string[]): string {
  return `${clientId}:${[...names].sort().join("|")}`;
}

function cacheSet(key: string, value: Map<string, PreviousLog>): void {
  if (lastLogsCache.size >= LAST_LOGS_CACHE_MAX_SIZE) {
    const oldest = lastLogsCache.keys().next();
    if (!oldest.done) lastLogsCache.delete(oldest.value);
  }
  lastLogsCache.set(key, { at: Date.now(), value });
}

export async function getPreviousWorkoutLogs(
  client: Client,
  exerciseNames: string[],
): Promise<Map<string, PreviousLog>> {
  const result = new Map<string, PreviousLog>();
  const wanted = new Set(
    exerciseNames.map((n) => n.trim().toLowerCase()).filter(Boolean),
  );
  if (wanted.size === 0) return result;

  const key = cacheKey(client.id, Array.from(wanted));
  const cached = lastLogsCache.get(key);
  if (cached && Date.now() - cached.at < LAST_LOGS_CACHE_TTL_MS) {
    return cached.value;
  }

  const tz = client.timezone || DEFAULT_TIMEZONE;
  const todayStr = getTodayDateStr(tz);

  const orFilter = Array.from(wanted).map(postgrestValue).map((n) => `exercise.ilike.${n}`).join(",");

  const { data, error } = await supabaseAdmin
    .from("workout_logs")
    .select("exercise, date, sets, reps, weight")
    .eq("client_id", client.id)
    .lt("date", todayStr)
    .or(orFilter)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    console.error(`[WORKOUT] Previous logs query error for ${client.id}:`, error.message);
    return result;
  }

  for (const row of data ?? []) {
    const name = row.exercise?.trim().toLowerCase() ?? "";
    if (!name || isPseudoName(name) || !wanted.has(name)) continue;
    if (result.has(name)) continue;
    result.set(name, {
      weight: row.weight,
      sets: row.sets,
      reps: row.reps,
    });
  }

  cacheSet(key, result);
  return result;
}

function formatPreviousLog(log: PreviousLog): string {
  const weight =
    log.weight != null && log.weight > 0 ? `${log.weight} кг` : log.weight === 0 ? "вес тела" : null;
  const perSetList = log.reps != null && String(log.reps).includes("/");
  const setsReps = perSetList
    ? log.reps
    : log.sets != null && log.reps
      ? `${log.sets}×${log.reps}`
      : log.sets != null
        ? `${log.sets} подх.`
        : log.reps
          ? log.reps
          : null;
  return [weight, setsReps].filter(Boolean).join(" ");
}

export function formatExercise(
  index: number,
  ex: ParsedExercise,
  lang: Language,
  last?: PreviousLog | null,
): string {
  const lines: string[] = [];

  lines.push(t("workout.exercise_item", lang, { index, name: ex.name }));

  const detailLine = formatExerciseDetailLine(ex);
  if (detailLine) lines.push(detailLine);

  const lastDetail = last ? formatPreviousLog(last) : "";
  if (lastDetail) {
    lines.push(t("workout.exercise_last", lang, { detail: lastDetail }));
  }

  if (ex.rest) {
    lines.push(t("workout.exercise_rest", lang, { rest: ex.rest }));
  }

  if (ex.notes) {
    lines.push(t("workout.exercise_notes", lang, { notes: ex.notes }));
  }

  return lines.join("\n");
}

export async function formatWorkoutMessage(
  workout: TodayWorkout,
  lang: Language,
  client: Client,
): Promise<string> {
  const lastLogs = await getPreviousWorkoutLogs(
    client,
    workout.exercises.map((ex) => ex.name),
  );

  const lines: string[] = [];

  lines.push(t("workout.today_title", lang));
  lines.push("");

  const weekParts: string[] = [t("workout.week_label", lang, { week: workout.week_number })];
  if (workout.is_deload) weekParts.push(t("workout.deload_badge", lang));
  lines.push(weekParts.join(" | "));

  lines.push(t("workout.day_label", lang, { day: workout.day_name }));

  if (workout.goal) {
    lines.push(t("workout.goal_label", lang, { goal: workout.goal }));
  }

  lines.push("");
  lines.push(t("workout.exercises_header", lang));

  for (let i = 0; i < workout.exercises.length; i++) {
    const name = workout.exercises[i].name.trim().toLowerCase();
    lines.push(formatExercise(i + 1, workout.exercises[i], lang, lastLogs.get(name)));
    lines.push("");
  }

  return lines.join("\n").trim();
}

export async function formatSingleExercise(
  index: number,
  total: number,
  ex: ParsedExercise,
  lang: Language,
  client: Client,
): Promise<string> {
  const lines: string[] = [];

  lines.push(t("workout.exercise_header", lang, { current: index + 1, total }));
  lines.push("");
  lines.push(ex.name);

  if (ex.block) {
    lines.push("");
    lines.push(t("workout.exercise_block", lang, { block: ex.block }));
  }

  if (ex.sets && ex.reps) {
    lines.push(t("workout.exercise_sets_reps", lang, { sets: ex.sets, reps: ex.reps }));
  }

  if (ex.weight) {
    lines.push(t("workout.exercise_weight", lang, { weight: ex.weight }));
  }

  if (ex.rpe) {
    lines.push(t("workout.exercise_rpe", lang, { rpe: ex.rpe }));
  }

  if (ex.rest) {
    lines.push(t("workout.exercise_rest_detail", lang, { rest: ex.rest }));
  }

  const lastLogs = await getPreviousWorkoutLogs(client, [ex.name]);
  const last = lastLogs.get(ex.name.trim().toLowerCase());
  const lastDetail = last ? formatPreviousLog(last) : "";
  if (lastDetail) {
    lines.push("");
    lines.push(t("workout.exercise_last", lang, { detail: lastDetail }));
  }

  if (ex.notes) {
    lines.push("");
    lines.push(t("workout.exercise_notes", lang, { notes: ex.notes }));
  }

  return lines.join("\n");
}

export async function getTodayProgress(
  client: Client,
): Promise<{ exercise: string; done: boolean }[]> {
  if (!client.program_id) return [];

  const workout = await getTodayWorkout(client);
  if (!workout) return [];

  const tz = client.timezone || DEFAULT_TIMEZONE;
  const todayStr = getTodayDateStr(tz);

  const { data: logs } = await supabaseAdmin
    .from("workout_logs")
    .select("exercise")
    .eq("client_id", client.id)
    .eq("date", todayStr)
    .eq("week", workout.week_number);

  const doneExercises = new Set(
    (logs ?? []).map((l) => l.exercise?.toLowerCase()).filter(Boolean),
  );

  return workout.exercises.map((ex) => ({
    exercise: ex.name,
    done: doneExercises.has(ex.name.toLowerCase()),
  }));
}

export function formatProgressMessage(
  progress: { exercise: string; done: boolean }[],
  lang: Language,
): string {
  if (progress.length === 0) {
    return t("workout.progress_none", lang);
  }

  const lines: string[] = [t("workout.progress_title", lang), ""];

  for (const item of progress) {
    if (item.done) {
      lines.push(t("workout.progress_done", lang, { exercise: item.exercise }));
    } else {
      lines.push(t("workout.progress_remaining", lang, { exercise: item.exercise }));
    }
  }

  return lines.join("\n");
}

interface MeasurementRow {
  date: string;
  weight: number | null;
  waist: number | null;
  abdomen: number | null;
  chest: number | null;
  hips: number | null;
  body_fat: number | null;
}

export async function getMeasurementTrends(
  clientId: string,
): Promise<MeasurementRow[]> {
  const { data } = await supabaseAdmin
    .from("measurements")
    .select("date, weight, waist, abdomen, chest, hips, body_fat")
    .eq("client_id", clientId)
    .order("date", { ascending: false })
    .limit(4);

  return (data ?? []) as MeasurementRow[];
}

export function formatTrendsMessage(
  trends: MeasurementRow[],
  lang: Language,
): string {
  if (trends.length === 0) {
    return t("measure.trends_empty", lang);
  }

  const lines: string[] = [
    t("measure.trends_title", lang),
    t("measure.trends_measures", lang, { count: String(trends.length) }),
    "",
  ];

  const fields: [keyof MeasurementRow, string][] = [
    ["weight", "measure.step_weight"],
    ["waist", "measure.step_waist"],
    ["abdomen", "measure.step_abdomen"],
    ["chest", "measure.step_chest"],
    ["hips", "measure.step_hips"],
    ["body_fat", "measure.step_body_fat"],
  ];

  const latest = trends[0];
  const previous = trends.length > 1 ? trends[1] : null;

  for (const [key, labelKey] of fields) {
    const current = latest[key] as number | null;
    if (current == null) continue;

    const label = t(labelKey, lang);

    if (!previous) {
      lines.push(t("measure.trends_no_change", lang, { label, current: String(current) }));
      continue;
    }

    const prev = previous[key] as number | null;
    if (prev == null) {
      lines.push(t("measure.trends_no_change", lang, { label, current: String(current) }));
      continue;
    }

    const delta = current - prev;
    if (delta === 0) {
      lines.push(t("measure.trends_no_change", lang, { label, current: String(current) }));
    } else if (delta > 0) {
      lines.push(t("measure.trends_delta_up", lang, {
        label,
        prev: String(prev),
        current: String(current),
        delta: String(delta),
      }));
    } else {
      lines.push(t("measure.trends_delta_down", lang, {
        label,
        prev: String(prev),
        current: String(current),
        delta: String(Math.abs(delta)),
      }));
    }
  }

  return lines.join("\n");
}

export function truncateMessage(message: string, suffix: string): string {
  if (message.length <= TELEGRAM_MAX_MESSAGE_LENGTH) return message;
  const limit = TELEGRAM_MAX_MESSAGE_LENGTH - suffix.length - 1;
  const truncated = message.slice(0, limit);
  const lastNewline = truncated.lastIndexOf("\n");
  const safeTruncated = lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated;
  return safeTruncated + suffix;
}

export async function sendTodayWorkout(
  sender: WorkoutSender,
  client: Client,
  telegramId: number,
): Promise<boolean> {
  const workout = await getTodayWorkout(client, sender.language);

  if (!workout) {
    await sender.reply(t("workout.no_workout_today", sender.language));
    return false;
  }

  try {
    const { setState } = await import("../state/machine.js");
    await setState(telegramId, {
      action: "today",
      step: "viewing",
      data: {
        week_number: workout.week_number,
        day_name: workout.day_name,
        exercise_count: workout.exercises.length,
      },
    });
  } catch (stateErr) {
    console.warn(`[WORKOUT] setState failed for ${telegramId}:`, stateErr);
  }

  const message = await formatWorkoutMessage(workout, sender.language, client);
  const truncated = truncateMessage(message, t("program.truncation_suffix", sender.language));

  const buttons = [
    [{ text: t("workout.open_button", sender.language), callback_data: "today_open" }],
    [{ text: t("workout.skip_button", sender.language), callback_data: "skip_workout" }],
  ];

  await sender.reply(truncated, {
    reply_markup: {
      inline_keyboard: buttons,
    },
  });

  return true;
}
