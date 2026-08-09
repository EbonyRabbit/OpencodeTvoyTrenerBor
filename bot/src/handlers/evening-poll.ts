import type { MyContext } from "../bot.js";
import { t, type Language } from "../i18n/index.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { getTodayWorkout, getTodayDateStr, getTodayISODay, getCurrentWeekRow } from "../lib/workout-utils.js";
import { DEFAULT_TIMEZONE } from "../lib/constants.js";
import {
  getEffectiveTrainingDays,
  availablePostponeDays,
  replaceTrainingDay,
  dayAvailability,
} from "../lib/postpone-utils.js";
import { weekdayShortLabel, startTrainingDaysSetup } from "./training-days.js";

export { DEFAULT_TIMEZONE };

async function handleEveningResponse(
  ctx: MyContext,
  response: "yes" | "no",
): Promise<boolean> {
  if (!ctx.from?.id || !ctx.callbackQuery?.data) return false;

  const client = ctx.client;
  if (!client) return false;

  const tz = client.timezone || DEFAULT_TIMEZONE;
  const todayStr = getTodayDateStr(tz);
  const lang = (client.language || "ru") as Language;

  const workout = await getTodayWorkout(client);
  if (!workout) {
    const noWorkoutMsg = t("evening.no_workout", lang);
    await ctx.answerCallbackQuery({ text: noWorkoutMsg }).catch(() => {});
    await ctx.editMessageText(noWorkoutMsg).catch(() => {});
    return true;
  }

  const logEntry = {
    client_id: client.id,
    date: todayStr,
    week: workout.week_number,
    day_order: workout.day_order,
    exercise: `[EVENING_${response.toUpperCase()}]`,
    comment: `Evening poll: ${response}`,
  } as never;

  const { error } = await supabaseAdmin.from("workout_logs").insert(logEntry);

  if (error) {
    console.error(`[EVENING] Failed to log response for ${client.id}:`, error);
    await ctx.answerCallbackQuery({ text: "Error" }).catch(() => {});
    return false;
  }

  const responseKey = `evening.response_${response}` as "evening.response_yes" | "evening.response_no";
  const confirmation = t(responseKey, lang);

  await ctx.answerCallbackQuery({ text: confirmation }).catch(() => {});
  await ctx.editMessageText(`${t("evening.poll_question", lang)}\n\n${confirmation}`).catch(() => {});

  return true;
}

export async function handleEveningYes(ctx: MyContext): Promise<boolean> {
  return handleEveningResponse(ctx, "yes");
}

export async function handleEveningNo(ctx: MyContext): Promise<boolean> {
  return handleEveningResponse(ctx, "no");
}

export async function handleEveningPostpone(ctx: MyContext): Promise<boolean> {
  if (!ctx.from?.id || !ctx.callbackQuery?.id) return false;

  const client = ctx.client;
  if (!client) return false;

  const tz = client.timezone || DEFAULT_TIMEZONE;
  const todayStr = getTodayDateStr(tz);
  const lang = (client.language || "ru") as Language;
  const todayIso = getTodayISODay(tz);

  const workout = await getTodayWorkout(client);
  if (!workout) {
    const noWorkoutMsg = t("evening.no_workout", lang);
    await ctx.answerCallbackQuery({ text: noWorkoutMsg }).catch(() => {});
    await ctx.editMessageText(noWorkoutMsg).catch(() => {});
    return true;
  }

  const weekRow = await getCurrentWeekRow(client, todayStr);
  if (!weekRow) {
    await ctx.answerCallbackQuery({ text: t("evening.postpone_unavailable", lang), show_alert: true }).catch(() => {});
    return false;
  }

  const occupied = getEffectiveTrainingDays(client, weekRow) ?? [];
  if (!occupied.includes(todayIso)) {
    await ctx.answerCallbackQuery({ text: t("evening.postpone_occupied_alert", lang), show_alert: true }).catch(() => {});
    return false;
  }

  const available = availablePostponeDays(todayStr, weekRow.end_date);

  if (available.length === 0) {
    await ctx.answerCallbackQuery({ text: t("evening.postpone_no_days", lang), show_alert: true }).catch(() => {});
    return true;
  }

  await ctx.answerCallbackQuery().catch(() => {});

  await ctx
    .editMessageText(
      `${t("evening.poll_question", lang)}\n\n${t("evening.postpone_title", lang)}\n${t("evening.postpone_hint", lang)}`,
      { reply_markup: { inline_keyboard: buildPostponeKeyboard(available, occupied, lang) } },
    )
    .catch(() => {});

  return true;
}

export function buildPostponeKeyboard(
  available: number[],
  occupied: number[],
  lang: Language,
): { text: string; callback_data: string }[][] {
  const rows: { text: string; callback_data: string }[][] = [];

  for (const iso of available) {
    const taken = occupied.includes(iso);
    rows.push([
      {
        text: taken
          ? `⛔ ${weekdayShortLabel(iso, lang)} · ${t("evening.postpone_taken", lang)}`
          : `✅ ${weekdayShortLabel(iso, lang)}`,
        callback_data: taken ? `postpone_taken:${iso}` : `postpone_move:${iso}`,
      },
    ]);
  }

  rows.push([{ text: t("evening.postpone_week_button", lang), callback_data: "postpone_week" }]);
  rows.push([{ text: t("evening.postpone_cancel", lang), callback_data: "postpone_cancel" }]);

  return rows;
}

export async function handlePostponeMove(ctx: MyContext, isoRaw: string): Promise<boolean> {
  if (!ctx.client || !ctx.from?.id || !ctx.callbackQuery?.id) return false;

  const client = ctx.client;
  const tz = client.timezone || DEFAULT_TIMEZONE;
  const todayStr = getTodayDateStr(tz);
  const lang = (client.language || "ru") as Language;
  const targetIso = Number(isoRaw);
  const todayIso = getTodayISODay(tz);

  if (!Number.isInteger(targetIso) || targetIso < 1 || targetIso > 7) {
    await ctx.answerCallbackQuery({ text: t("evening.postpone_unavailable", lang), show_alert: true }).catch(() => {});
    return false;
  }

  const weekRow = await getCurrentWeekRow(client, todayStr);
  if (!weekRow) {
    await ctx.answerCallbackQuery({ text: t("evening.postpone_expired", lang), show_alert: true }).catch(() => {});
    return false;
  }

  const occupied = getEffectiveTrainingDays(client, weekRow) ?? [];
  if (!occupied.includes(todayIso)) {
    await ctx.answerCallbackQuery({ text: t("evening.postpone_expired", lang), show_alert: true }).catch(() => {});
    return false;
  }

  const available = availablePostponeDays(todayStr, weekRow.end_date);
  const availability = dayAvailability(targetIso, available, occupied);

  if (!availability.ok) {
    await ctx.answerCallbackQuery({
      text: availability.reason === "occupied"
        ? t("evening.postpone_occupied_alert", lang)
        : t("evening.postpone_expired", lang),
      show_alert: true,
    }).catch(() => {});
    return false;
  }

  if (weekRow.start_date) {
    const targetDate = new Date(`${weekRow.start_date}T12:00:00Z`);
    targetDate.setUTCDate(targetDate.getUTCDate() + (targetIso - 1));
    const targetDateStr = targetDate.toISOString().slice(0, 10);
    if (targetDateStr <= todayStr) {
      await ctx.answerCallbackQuery({ text: t("evening.postpone_expired", lang), show_alert: true }).catch(() => {});
      return false;
    }
  }

  const newDays = replaceTrainingDay(occupied, todayIso, targetIso);

  const { error } = await supabaseAdmin
    .from("program_schedule")
    .update({ training_days: newDays, updated_at: new Date().toISOString() })
    .eq("id", weekRow.id);

  if (error) {
    console.error(`[EVENING] Postpone save error for ${client.id}:`, error.message);
    await ctx.answerCallbackQuery({ text: t("error.service_unavailable", lang), show_alert: true }).catch(() => {});
    return false;
  }

  const postponeLog = {
    client_id: client.id,
    date: todayStr,
    week: weekRow.week_number,
    day_order: null,
    exercise: "[EVENING_POSTPONE]",
    comment: `Moved training to weekday ${targetIso}`,
  } as never;

  const { error: logError } = await supabaseAdmin.from("workout_logs").insert(postponeLog);
  if (logError) {
    console.warn(`[EVENING] Postpone log insert failed for ${client.id}:`, logError.message);
  }

  const dayName = t(`schedule.day_fullnames.${String(targetIso)}`, lang);

  await ctx.answerCallbackQuery().catch(() => {});
  await ctx
    .editMessageText(`${t("evening.poll_question", lang)}\n\n${t("evening.postpone_moved", lang, { day: dayName })}`)
    .catch(() => {});

  return true;
}

export async function handlePostponeWeek(ctx: MyContext): Promise<boolean> {
  if (!ctx.from?.id) return false;

  const client = ctx.client;
  if (!client) return false;

  await ctx.answerCallbackQuery().catch(() => {});

  const tz = client.timezone || DEFAULT_TIMEZONE;
  const todayStr = getTodayDateStr(tz);
  const lang = (client.language || "ru") as Language;

  const weekRow = await getCurrentWeekRow(client, todayStr);
  if (!weekRow) {
    await ctx.reply(t("evening.postpone_unavailable", lang));
    return false;
  }

  const opened = await startTrainingDaysSetup(ctx, {
    id: weekRow.id,
    trainingDays: getEffectiveTrainingDays(client, weekRow) ?? [],
  });

  if (opened) {
    await ctx
      .editMessageText(`${t("evening.poll_question", lang)}\n\n${t("evening.postpone_editor_open", lang)}`)
      .catch(() => {});
  }

  return true;
}

export async function handlePostponeTaken(ctx: MyContext): Promise<boolean> {
  const lang = (ctx.client?.language || "ru") as Language;
  await ctx.answerCallbackQuery({ text: t("evening.postpone_occupied_alert", lang), show_alert: true }).catch(() => {});
  return true;
}

export async function handlePostponeCancel(ctx: MyContext): Promise<boolean> {
  await ctx.answerCallbackQuery().catch(() => {});
  return true;
}