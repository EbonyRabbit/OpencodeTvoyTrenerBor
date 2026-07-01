import type { MyContext } from "../bot.js";
import { guardActiveClient } from "./guards.js";

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
    await ctx.answerCallbackQuery({ text: "Ошибка подключения. Попробуйте позже.", show_alert: true }).catch(() => {});
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
    await ctx.answerCallbackQuery({ text: "Неизвестное действие. Обновите меню." }).catch(() => {});
    return;
  }

  try {
    await handler(ctx, params);
    await ctx.answerCallbackQuery().catch(() => {});
  } catch (err) {
    console.error(`[CALLBACK] Error handling ${query.data} for ${ctx.from?.id}:`, err);
    await ctx.answerCallbackQuery({
      text: "Произошла ошибка. Попробуйте ещё раз.",
      show_alert: true,
    }).catch(() => {});
  }
}

registerCallback("today_open", handleTodayOpen);
registerCallback("exercise_log", handleExerciseLog);
registerCallback("exercise_skip", handleExerciseSkip);
registerCallback("skip_workout", handleSkipWorkout);

async function handleTodayOpen(ctx: MyContext, _params: string): Promise<void> {
  await ctx.reply("🏋️ Загрузка тренировки дня...");
}

async function handleExerciseLog(ctx: MyContext, params: string): Promise<void> {
  const index = Number(params);
  if (!Number.isInteger(index) || index < 0) {
    await ctx.reply("Некорректный индекс упражнения.");
    return;
  }
  await ctx.reply(`📝 Логирование упражнения #${index}...`);
}

async function handleExerciseSkip(ctx: MyContext, params: string): Promise<void> {
  const index = Number(params);
  if (!Number.isInteger(index) || index < 0) {
    await ctx.reply("Некорректный индекс упражнения.");
    return;
  }
  await ctx.reply(`⏭ Упражнение #${index} пропущено.`);
}

async function handleSkipWorkout(ctx: MyContext, _params: string): Promise<void> {
  await ctx.reply("⏭ Тренировка пропущена.");
}
