import type { MyContext } from "../bot.js";
import { guardActiveClient } from "./guards.js";
import {
  getTodayWorkout,
  formatSingleExercise,
  type TodayWorkout,
} from "../lib/workout-utils.js";
import { t, type Language } from "../i18n/index.js";
import { setState, clearState } from "../state/machine.js";

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

  const text = formatSingleExercise(
    index,
    effectiveWorkout.exercises.length,
    effectiveWorkout.exercises[index],
    ctx.language,
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

  await ctx.answerCallbackQuery({ text: t("callback.exercise_logging", ctx.language, { index: index + 1 }) }).catch(() => {});

  // TODO: Task 3.4 — start exercise logging flow (sets → reps → weight → RPE → comment)
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
  await ctx.answerCallbackQuery({ text: t("callback.workout_skipped", ctx.language) }).catch(() => {});
  if (ctx.from?.id) {
    try {
      await clearState(ctx.from.id);
    } catch (err) {
      console.warn(`[CALLBACK] clearState failed for ${ctx.from?.id}:`, err);
    }
  }
}
