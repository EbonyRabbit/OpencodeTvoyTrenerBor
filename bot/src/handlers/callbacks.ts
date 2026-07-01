import type { MyContext } from "../bot.js";
import { guardActiveClient } from "./guards.js";
import { sendTodayWorkout } from "../lib/workout-utils.js";
import { t } from "../i18n/index.js";

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
    await ctx.answerCallbackQuery().catch(() => {});
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
registerCallback("skip_workout", handleSkipWorkout);

async function handleTodayOpen(ctx: MyContext, _params: string): Promise<void> {
  if (!ctx.client || !ctx.from?.id) {
    await ctx.reply(t("error.user_not_identified", ctx.language));
    return;
  }

  try {
    await sendTodayWorkout(ctx, ctx.client, ctx.from.id);
  } catch (err) {
    console.error(`[CALLBACK] today_open error for ${ctx.from?.id}:`, err);
    try {
      await ctx.reply(t("error.service_unavailable", ctx.language));
    } catch {
      // fallback reply failed
    }
  }
}

async function handleExerciseLog(ctx: MyContext, params: string): Promise<void> {
  const index = Number(params);
  if (!Number.isInteger(index) || index < 1) {
    await ctx.reply(t("error.invalid_exercise_index", ctx.language));
    return;
  }
  await ctx.reply(t("callback.exercise_logging", ctx.language, { index }));
}

async function handleExerciseSkip(ctx: MyContext, params: string): Promise<void> {
  const index = Number(params);
  if (!Number.isInteger(index) || index < 1) {
    await ctx.reply(t("error.invalid_exercise_index", ctx.language));
    return;
  }
  await ctx.reply(t("callback.exercise_skipped", ctx.language, { index }));
}

async function handleSkipWorkout(ctx: MyContext, _params: string): Promise<void> {
  await ctx.reply(t("callback.workout_skipped", ctx.language));
}
