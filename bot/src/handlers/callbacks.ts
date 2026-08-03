import type { MyContext } from "../bot.js";
import { guardActiveClient } from "./guards.js";
import {
  getTodayWorkout,
  formatSingleExercise,
  type TodayWorkout,
} from "../lib/workout-utils.js";
import { t, type Language } from "../i18n/index.js";
import { setState, clearState } from "../state/machine.js";
import { startExerciseLogging, handleWizardSkip } from "./wizard.js";
import { handleEveningYes, handleEveningNo, handleEveningPostpone } from "./evening-poll.js";
import { startMeasurements, showMeasurementHistory } from "./measurements.js";
import { handleScheduleStart, handleScheduleToggle, handleScheduleDone, handleScheduleCancel } from "./training-days.js";
import { handleResumeCallback } from "./resume.js";
// import { showPhotoHistory } from "./photos.js"; // DISABLED: photo storage removed
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { getTodayDateStr } from "../lib/workout-utils.js";
import { DEFAULT_TIMEZONE } from "../lib/constants.js";
import { markAsSent } from "../cron/dedup.js";

type CallbackHandler = (ctx: MyContext, params: string) => Promise<void>;

const callbackHandlers = new Map<string, CallbackHandler>();
const processedCallbacks = new Set<string>();
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function registerCallback(prefix: string, handler: CallbackHandler): void {
  callbackHandlers.set(prefix, handler);
}

function cleanupProcessedCallbacks(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  processedCallbacks.clear();
  lastCleanup = now;
}

export async function callbackRouter(ctx: MyContext): Promise<void> {
  const query = ctx.callbackQuery;
  if (!query?.id) return;

  if (processedCallbacks.has(query.id)) return;
  processedCallbacks.add(query.id);
  cleanupProcessedCallbacks();

  if (!query.data) {
    console.warn(`[CALLBACK] Empty callback_data from ${ctx.from?.id}`);
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  let guard: Awaited<ReturnType<typeof guardActiveClient>>;
  try {
    guard = await guardActiveClient(ctx);
  } catch (err) {
    console.error(`[CALLBACK] Guard failed for ${ctx.from?.id}:`, err);
    await ctx.answerCallbackQuery({ text: t("error.connection_error", ctx.language), show_alert: true }).catch(() => {});
    return;
  }

  if (typeof guard === "string") {
    await ctx.answerCallbackQuery({ text: guard, show_alert: true }).catch(() => {});
    return;
  }

  ctx.client = guard.client;

  const colonIndex = query.data.indexOf(":");
  const prefix = colonIndex === -1 ? query.data : query.data.slice(0, colonIndex);
  const params = colonIndex === -1 ? "" : query.data.slice(colonIndex + 1);

  const handler = callbackHandlers.get(prefix);
  if (!handler) {
    console.warn(`[CALLBACK] Unknown callback_data: ${query.data} from ${ctx.from?.id}`);
    await ctx.answerCallbackQuery({ text: t("error.unknown_callback", ctx.language) }).catch(() => {});
    return;
  }

  try {
    await handler(ctx, params);
  } catch (err) {
    console.error(`[CALLBACK] Error handling ${query.data} for ${ctx.from?.id}:`, err);
    await ctx.answerCallbackQuery({
      text: t("error.callback_error", ctx.language),
      show_alert: true,
    }).catch(() => {});
  }
}

registerCallback("today_open", handleTodayOpen);
registerCallback("exercise_log", handleExerciseLog);
registerCallback("exercise_skip", handleExerciseSkip);
registerCallback("exercise_prev", handleExercisePrev);
registerCallback("exercise_next", handleExerciseNext);
registerCallback("skip_workout", handleSkipWorkout);
registerCallback("wizard_skip", handleWizardSkip);
registerCallback("evening_yes", async (ctx) => { await handleEveningYes(ctx); });
registerCallback("evening_no", async (ctx) => { await handleEveningNo(ctx); });
registerCallback("evening_postpone", async (ctx) => { await handleEveningPostpone(ctx); });
registerCallback("measurements_start", async (ctx) => { await startMeasurements(ctx); });
registerCallback("measurements_history", async (ctx) => { await showMeasurementHistory(ctx); });
// registerCallback("photo_history", async (ctx) => { await ctx.answerCallbackQuery().catch(() => {}); await showPhotoHistory(ctx); }); // DISABLED: photo storage removed
registerCallback("resume", async (ctx, strategy) => { await handleResumeCallback(ctx, strategy); });
registerCallback("sched_start", async (ctx) => { await handleScheduleStart(ctx); });
registerCallback("sched_toggle", async (ctx, iso) => { await handleScheduleToggle(ctx, iso); });
registerCallback("sched_done", async (ctx) => { await handleScheduleDone(ctx); });
registerCallback("sched_cancel", async (ctx) => { await handleScheduleCancel(ctx); });

function buildExerciseKeyboard(
  index: number,
  total: number,
  lang: Language,
): { text: string; callback_data: string }[][] {
  const rows: { text: string; callback_data: string }[][] = [];

  rows.push([
    { text: t("workout.btn_done", lang), callback_data: `exercise_log:${index}` },
    { text: t("workout.btn_skip_exercise", lang), callback_data: `exercise_skip:${index}` },
  ]);

  const navRow: { text: string; callback_data: string }[] = [];
  if (index > 0) navRow.push({ text: t("workout.btn_prev", lang), callback_data: `exercise_prev:${index}` });
  if (index < total - 1) navRow.push({ text: t("workout.btn_next", lang), callback_data: `exercise_next:${index}` });
  if (navRow.length > 0) rows.push(navRow);

  rows.push([{ text: t("workout.skip_button", lang), callback_data: "skip_workout" }]);

  return rows;
}

async function showExercise(
  ctx: MyContext,
  index: number,
  workout?: TodayWorkout | null,
): Promise<void> {
  if (!ctx.client || !ctx.from?.id) return;

  const effectiveWorkout = workout ?? await getTodayWorkout(ctx.client);
  if (!effectiveWorkout || !effectiveWorkout.exercises[index]) {
    await ctx.reply(t("workout.exercise_all_done", ctx.language));
    try {
      await clearState(ctx.from.id);
    } catch (err) {
      console.warn(`[CALLBACK] clearState failed for ${ctx.from.id}:`, err);
    }
    return;
  }

  const text = await formatSingleExercise(
    index,
    effectiveWorkout.exercises.length,
    effectiveWorkout.exercises[index],
    ctx.language,
    ctx.client,
  );
  const keyboard = buildExerciseKeyboard(index, effectiveWorkout.exercises.length, ctx.language);

  await ctx.reply(text, {
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function handleTodayOpen(ctx: MyContext, _params: string): Promise<void> {
  if (!ctx.client || !ctx.from?.id) {
    await ctx.reply(t("error.user_not_identified", ctx.language));
    return;
  }

  try {
    const workout = await getTodayWorkout(ctx.client);
    if (!workout) {
      await ctx.answerCallbackQuery({ text: t("workout.no_workout_today", ctx.language) }).catch(() => {});
      await ctx.reply(t("workout.no_workout_today", ctx.language));
      return;
    }

    try {
      await setState(ctx.from.id, {
        action: "today",
        step: "viewing",
        data: {
          week_number: workout.week_number,
          day_name: workout.day_name,
          exercise_count: workout.exercises.length,
          exercise_index: 0,
        },
      });
    } catch (stateErr) {
      console.warn(`[CALLBACK] setState failed for ${ctx.from.id}:`, stateErr);
    }

    await ctx.answerCallbackQuery().catch(() => {});
    await showExercise(ctx, 0, workout);
  } catch (err) {
    console.error(`[CALLBACK] today_open error for ${ctx.from?.id}:`, err);
    await ctx.answerCallbackQuery().catch(() => {});
    try {
      await ctx.reply(t("error.service_unavailable", ctx.language));
    } catch {
      // fallback reply failed
    }
  }
}

async function handleExerciseLog(ctx: MyContext, params: string): Promise<void> {
  const index = Number(params);
  if (!Number.isInteger(index) || index < 0 || !params) {
    await ctx.answerCallbackQuery({ text: t("error.invalid_exercise_index", ctx.language), show_alert: true }).catch(() => {});
    return;
  }

  if (!ctx.client) {
    await ctx.answerCallbackQuery({ text: t("error.user_not_identified", ctx.language), show_alert: true }).catch(() => {});
    return;
  }

  const workout = await getTodayWorkout(ctx.client);
  if (!workout || !workout.exercises[index]) {
    await ctx.answerCallbackQuery({ text: t("error.invalid_exercise_index", ctx.language), show_alert: true }).catch(() => {});
    return;
  }

  await ctx.answerCallbackQuery().catch(() => {});
  await startExerciseLogging(ctx, index, workout);
}

async function handleExerciseSkip(ctx: MyContext, params: string): Promise<void> {
  const index = Number(params);
  if (!Number.isInteger(index) || index < 0 || !params) {
    await ctx.answerCallbackQuery({ text: t("error.invalid_exercise_index", ctx.language), show_alert: true }).catch(() => {});
    return;
  }

  await ctx.answerCallbackQuery({ text: t("callback.exercise_skipped", ctx.language, { index: index + 1 }) }).catch(() => {});
  await showExercise(ctx, index + 1);
}

async function handleExercisePrev(ctx: MyContext, params: string): Promise<void> {
  const index = Number(params);
  if (!Number.isInteger(index) || index <= 0 || !params) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }
  await ctx.answerCallbackQuery().catch(() => {});
  await showExercise(ctx, index - 1);
}

async function handleExerciseNext(ctx: MyContext, params: string): Promise<void> {
  const index = Number(params);
  if (!Number.isInteger(index) || index < 0 || !params) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }
  await ctx.answerCallbackQuery().catch(() => {});
  await showExercise(ctx, index + 1);
}

async function handleSkipWorkout(ctx: MyContext, _params: string): Promise<void> {
  if (!ctx.from?.id) return;

  await ctx.answerCallbackQuery().catch(() => {});

  if (ctx.client) {
    try {
      await setState(ctx.from.id, {
        action: "skip_workout",
        step: "reason",
        data: {},
      }, ctx.state);
    } catch (err) {
      console.warn(`[CALLBACK] setState failed for ${ctx.from.id}:`, err);
      await ctx.reply(t("error.service_unavailable", ctx.language));
      return;
    }
  }

  await ctx.reply(t("wizard.skip_reason_prompt", ctx.language));
}

export async function handleSkipReason(ctx: MyContext): Promise<boolean> {
  if (!ctx.state || ctx.state.action !== "skip_workout" || !ctx.from?.id || !ctx.client) return false;

  const text = ctx.message?.text?.trim();
  if (!text) return false;

  const reason = text === "/skip" ? t("wizard.skip_no_reason", ctx.language) : text;

  const tz = ctx.client.timezone || DEFAULT_TIMEZONE;
  const todayStr = getTodayDateStr(tz);

  const { error } = await supabaseAdmin.from("workout_logs").insert({
    client_id: ctx.client.id,
    date: todayStr,
    week: null,
    exercise: "[SKIP]",
    sets: null,
    reps: null,
    weight: null,
    rpe: null,
    comment: reason,
  });

  if (error) {
    console.error(`[SKIP] Insert error for ${ctx.from.id}:`, error.message);
    await ctx.reply(t("error.service_unavailable", ctx.language));
  } else {
    const dedupResult = await markAsSent(`workout_skipped:${ctx.client.id}:${todayStr}`);
    if (dedupResult === "error") {
      console.warn(`[SKIP] Dedup write failed for ${ctx.client.id}`);
    }
    await ctx.reply(t("wizard.skip_logged", ctx.language, { reason }));
  }

  try {
    await clearState(ctx.from.id);
  } catch (err) {
    console.warn(`[CALLBACK] clearState failed for ${ctx.from.id}:`, err);
  }

  return true;
}
