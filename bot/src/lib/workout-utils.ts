import { supabaseAdmin } from "./supabase-admin.js";
import type { Client } from "./clients.js";
import { getParsedContent, type ParsedExercise } from "./program-utils.js";
import { t, type Language } from "../i18n/index.js";

const DEFAULT_TIMEZONE = "Europe/Moscow";

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export interface TodayWorkout {
  day_name: string;
  exercises: ParsedExercise[];
  week_number: number;
  is_deload: boolean;
  goal: string | null;
}

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

function getTodayDateStr(timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
  });
  return formatter.format(new Date());
}

export async function getTodayWorkout(client: Client): Promise<TodayWorkout | null> {
  if (!client.program_id) return null;

  const tz = client.timezone || DEFAULT_TIMEZONE;
  const todayName = getTodayDayName(tz);
  const todayStr = getTodayDateStr(tz);

  const [scheduleResult, programResult] = await Promise.all([
    supabaseAdmin
      .from("program_schedule")
      .select("week_number, start_date, end_date, is_deload, focus")
      .eq("client_id", client.id)
      .order("start_date"),
    supabaseAdmin
      .from("programs")
      .select("parsed_content")
      .eq("id", client.program_id)
      .maybeSingle(),
  ]);

  if (scheduleResult.error) {
    console.error(`[WORKOUT] Schedule query error for ${client.id}:`, scheduleResult.error.message);
    return null;
  }

  if (programResult.error) {
    console.error(`[WORKOUT] Program query error for ${client.id}:`, programResult.error.message);
    return null;
  }

  const schedule = scheduleResult.data ?? [];
  const currentWeekRow = schedule.find((w) => {
    if (!w.start_date || !w.end_date) return false;
    return todayStr >= w.start_date && todayStr <= w.end_date;
  });

  if (!currentWeekRow) return null;

  const parsed = getParsedContent(programResult.data?.parsed_content ?? null);
  if (!parsed) return null;

  const weekData = parsed.weeks?.find((w) => w.week_number === currentWeekRow.week_number);
  if (!weekData?.days) return null;

  const matchedDay = weekData.days.find((d) => {
    const normalizedName = d.day_name.toLowerCase();
    return normalizedName.includes(todayName);
  });

  if (!matchedDay?.exercises?.length) return null;

  return {
    day_name: matchedDay.day_name,
    exercises: matchedDay.exercises,
    week_number: currentWeekRow.week_number,
    is_deload: currentWeekRow.is_deload,
    goal: currentWeekRow.focus,
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

  const buttons = [[{ text: t("workout.skip_button", sender.language), callback_data: "skip_workout" }]];

  await sender.reply(truncated, {
    reply_markup: {
      inline_keyboard: buttons,
    },
  });

  return true;
}
