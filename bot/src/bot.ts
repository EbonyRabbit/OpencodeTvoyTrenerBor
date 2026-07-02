import { Bot, type Context, BotError, GrammyError, HttpError } from "grammy";
import { config } from "./config.js";
import { startHandler } from "./handlers/start.js";
import { menuHandler } from "./handlers/menu.js";
import { myProgramHandler } from "./handlers/my-program.js";
import { todayHandler } from "./handlers/today.js";
import { callbackRouter, handleSkipReason } from "./handlers/callbacks.js";
import { guardActiveClient } from "./handlers/guards.js";
import { handleWizardInput, startExerciseLogging } from "./handlers/wizard.js";
import { startMeasurements, handleMeasurementsInput } from "./handlers/measurements.js";
import { getTodayWorkout } from "./lib/workout-utils.js";
import { getState, type BotState } from "./state/machine.js";
import { findClientByTelegramId, type Client } from "./lib/clients.js";
import { resolveLanguage, type Language, t } from "./i18n/index.js";
import { startEveningPollCron } from "./cron/evening-scheduler.js";

export interface MyContext extends Context {
  clientId?: string;
  language: Language;
  state?: BotState | null;
  client?: Client;
}

export const bot = new Bot<MyContext>(config.telegram.botToken);

bot.use(async (ctx, next) => {
  const start = Date.now();
  const updateType = ctx.update.message
    ? "message"
    : ctx.update.callback_query
      ? "callback_query"
      : "other";
  const userId = ctx.from?.id ?? "unknown";

  console.log(`[${new Date().toISOString()}] ${updateType} from ${userId}`);

  ctx.language = resolveLanguage(ctx.from?.language_code);

  if (ctx.from?.id) {
    try {
      ctx.state = await getState(ctx.from.id);
    } catch (err) {
      console.warn(`[STATE] Failed to load state for ${ctx.from?.id}:`, err);
      ctx.state = null;
    }

    if (ctx.state?.action === "exercise_log" || ctx.state?.action === "skip_workout" || ctx.state?.action === "measurements") {
      try {
        const client = await findClientByTelegramId(ctx.from.id);
        if (client) ctx.client = client;
      } catch (err) {
        console.warn(`[CLIENT] Failed to load client for ${ctx.from?.id}:`, err);
      }
    }
  }

  try {
    await next();
  } finally {
    console.log(`  ↳ ${updateType} processed in ${Date.now() - start}ms`);
  }
});

bot.command("start", startHandler);
bot.command("menu", menuHandler);
bot.command("today", todayHandler);
bot.command("myprogram", myProgramHandler);
bot.command("measure", async (ctx) => {
  const guard = await guardActiveClient(ctx);
  if (typeof guard === "string") {
    await ctx.reply(guard);
    return;
  }
  ctx.client = guard.client;
  await startMeasurements(ctx);
});

bot.on("callback_query:data", callbackRouter);

bot.on("message:text", async (ctx) => {
  if (ctx.state?.action === "exercise_log") {
    const result = await handleWizardInput(ctx);
    if (result.type === "expired") {
      await ctx.reply(t("wizard.wizard_expired", ctx.language));
    } else if (result.type === "completed" && result.nextExerciseIndex != null && ctx.client) {
      const workout = await getTodayWorkout(ctx.client);
      if (workout) {
        await startExerciseLogging(ctx, result.nextExerciseIndex, workout);
      }
    }
    return;
  }

  if (ctx.state?.action === "skip_workout") {
    const handled = await handleSkipReason(ctx);
    if (!handled) {
      await ctx.reply(t("wizard.skip_reason_prompt", ctx.language));
    }
    return;
  }

  if (ctx.state?.action === "measurements") {
    await handleMeasurementsInput(ctx);
    return;
  }

  const preview = ctx.message.text.length > 50
    ? ctx.message.text.slice(0, 50) + "..."
    : ctx.message.text;
  console.log(`Received message from ${ctx.from?.id}: ${preview}`);
  return ctx.reply("pong");
});

bot.errorBoundary((err: BotError<MyContext>) => {
  const error = err.error;
  console.error(`[ERROR] Update ${err.ctx.update.update_id} failed:`);

  if (error instanceof GrammyError) {
    console.error(`  GrammyError: ${error.description} (code: ${error.error_code})`);
  } else if (error instanceof HttpError) {
    console.error(`  HttpError: ${error.message}`);
  } else {
    console.error(`  Unknown: ${error instanceof Error ? error.stack : error}`);
  }
});
