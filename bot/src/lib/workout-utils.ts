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

export async function getTodayWorkout(client: Client): Promise<TodayWorkout | null> {
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

  const matchedDay = plan.days.find((d) => {
    const normalizedName = d.day_name.toLowerCase();
    return normalizedName.includes(todayName);
  });

  if (!matchedDay?.exercises?.length) return null;

  return {
    ...plan,
    day_name: matchedDay.day_name,
    exercises: matchedDay.exercises,
  };
}

function formatExerciseDetailLine(ex: ParsedExercise): string {
  const parts: string[] = [];
  if (ex.sets && ex.reps) parts.push(`${ex.sets}×${ex.reps}`);
  if (ex.weight) parts.push(ex.weight);
  if (ex.rpe) parts.push(`RPE ${ex.rpe}`);
  if (parts.length === 0) return "";
  return `   ${parts.join(", ")}`;
}

export function formatExercise(index: number, ex: ParsedExercise, lang: Language): string {
  const lines: string[] = [];

  lines.push(t("workout.exercise_item", lang, { index, name: ex.name }));

  const detailLine = formatExerciseDetailLine(ex);
  if (detailLine) lines.push(detailLine);

  if (ex.rest) {
    lines.push(t("workout.exercise_rest", lang, { rest: ex.rest }));
  }

  if (ex.notes) {
    lines.push(t("workout.exercise_notes", lang, { notes: ex.notes }));
  }

  return lines.join("\n");
}

export function formatWorkoutMessage(workout: TodayWorkout, lang: Language): string {
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
    lines.push(formatExercise(i + 1, workout.exercises[i], lang));
    lines.push("");
  }

  return lines.join("\n").trim();
}

export function formatSingleExercise(
  index: number,
  total: number,
  ex: ParsedExercise,
  lang: Language,
): string {
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
  const workout = await getTodayWorkout(client);

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

  const message = formatWorkoutMessage(workout, sender.language);
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
