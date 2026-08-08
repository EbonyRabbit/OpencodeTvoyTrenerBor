import { Bot, type Context, BotError, GrammyError, HttpError } from "grammy";
import { config } from "./config.js";
import { startHandler } from "./handlers/start.js";
import { menuHandler } from "./handlers/menu.js";
import { myProgramHandler } from "./handlers/my-program.js";
import { todayHandler } from "./handlers/today.js";
import { callbackRouter, handleSkipReason, showExercise } from "./handlers/callbacks.js";
import { guardActiveClient, guardAuthenticatedClient } from "./handlers/guards.js";
import { handleWizardInput } from "./handlers/wizard.js";
import { startMeasurements, handleMeasurementsInput, showMeasurementHistory } from "./handlers/measurements.js";
// import { startPhotos, handlePhotoMessage, showPhotoHistory } from "./handlers/photos.js"; // DISABLED: photo storage removed
import { startCheckin, handleCheckinInput } from "./handlers/checkin.js";
import { startPause, handlePauseInput } from "./handlers/pause.js";
import { startResume, handleResumeCallback } from "./handlers/resume.js";
import { programsHandler, handleProgramRequestCallback } from "./handlers/programs.js";
import { myStatsHandler } from "./handlers/my-stats.js";
import { myWebHandler } from "./handlers/my-web.js";
import { settingsHandler, handleSettingsCallback } from "./handlers/settings.js";
import { scheduleHandler } from "./handlers/training-days.js";
import { progressHandler } from "./handlers/progress.js";
import { handleConsentAccept } from "./handlers/consent.js";
import { handleFreeTextMessage, handleCoachIncoming, startCoachChat, handleChatSelectCallback, endCoachChat } from "./handlers/chat.js";
import { adminDebugToday, adminRecalcSchedule, adminGenerateCodes } from "./handlers/admin.js";
import { getTodayWorkout } from "./lib/workout-utils.js";
import { getState, type BotState } from "./state/machine.js";
import { findClientByTelegramId, type Client } from "./lib/clients.js";
import { resolveLanguage, type Language, t } from "./i18n/index.js";

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

    if (ctx.state?.action === "exercise_log" || ctx.state?.action === "skip_workout" || ctx.state?.action === "measurements" /* || ctx.state?.action === "photos" */ || ctx.state?.action === "checkin" || ctx.state?.action === "pause" || ctx.state?.action === "resume" || ctx.state?.action === "training_days") {
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
bot.command("progress", progressHandler);
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

bot.command("measurements", async (ctx) => {
  const guard = await guardActiveClient(ctx);
  if (typeof guard === "string") {
    await ctx.reply(guard);
    return;
  }
  ctx.client = guard.client;
  await showMeasurementHistory(ctx);
});

// DISABLED: photo storage removed
// bot.command("photos", async (ctx) => {
//   const guard = await guardActiveClient(ctx);
//   if (typeof guard === "string") {
//     await ctx.reply(guard);
//     return;
//   }
//   ctx.client = guard.client;
//   await startPhotos(ctx);
// });

// bot.command("photos_history", async (ctx) => {
//   const guard = await guardActiveClient(ctx);
//   if (typeof guard === "string") {
//     await ctx.reply(guard);
//     return;
//   }
//   ctx.client = guard.client;
//   await showPhotoHistory(ctx);
// });

bot.command("checkin", async (ctx) => {
  const guard = await guardActiveClient(ctx);
  if (typeof guard === "string") {
    await ctx.reply(guard);
    return;
  }
  ctx.client = guard.client;
  await startCheckin(ctx);
});

bot.command("pause", async (ctx) => {
  const guard = await guardActiveClient(ctx);
  if (typeof guard === "string") {
    await ctx.reply(guard);
    return;
  }
  ctx.client = guard.client;
  await startPause(ctx);
});

bot.command("resume", async (ctx) => {
  const guard = await guardActiveClient(ctx);
  if (typeof guard === "string") {
    await ctx.reply(guard);
    return;
  }
  ctx.client = guard.client;
  await startResume(ctx);
});

bot.command("programs", programsHandler);

bot.command("myweb", async (ctx) => {
  const guard = await guardAuthenticatedClient(ctx);
  if (typeof guard === "string") {
    await ctx.reply(guard);
    return;
  }
  ctx.client = guard.client;
  await myWebHandler(ctx);
});

bot.command("mystats", async (ctx) => {
  const guard = await guardActiveClient(ctx);
  if (typeof guard === "string") {
    await ctx.reply(guard);
    return;
  }
  ctx.client = guard.client;
  await myStatsHandler(ctx);
});

bot.command("schedule", async (ctx) => {
  const guard = await guardActiveClient(ctx);
  if (typeof guard === "string") {
    await ctx.reply(guard);
    return;
  }
  ctx.client = guard.client;
  await scheduleHandler(ctx);
});

bot.command("chat", startCoachChat);
bot.command("chat_end", endCoachChat);

bot.command("settings", async (ctx) => {
  const guard = await guardAuthenticatedClient(ctx);
  if (typeof guard === "string") {
    await ctx.reply(guard);
    return;
  }
  ctx.client = guard.client;
  await settingsHandler(ctx);
});
bot.command("debug_today", adminDebugToday);
bot.command("recalc_schedule", adminRecalcSchedule);
bot.command("generate_codes", adminGenerateCodes);

bot.on("callback_query:data", async (ctx, next) => {
  const data = ctx.callbackQuery?.data;
  if (data === "programs_open") {
    ctx.answerCallbackQuery().catch(() => {});
    await programsHandler(ctx);
    return;
  }
  if (data === "consent_accept") {
    await handleConsentAccept(ctx);
    return;
  }
  if (data?.startsWith("settings_")) {
    const guard = await guardAuthenticatedClient(ctx);
    if (typeof guard === "string") {
      await ctx.answerCallbackQuery({ text: guard, show_alert: true }).catch(() => {});
      return;
    }
    ctx.client = guard.client;
    await handleSettingsCallback(ctx, data);
    return;
  }
  if (data?.startsWith("program_request:")) {
    const programId = data.slice("program_request:".length);
    await handleProgramRequestCallback(ctx, programId);
    return;
  }
  if (data?.startsWith("chat_select:")) {
    const clientId = data.slice("chat_select:".length);
    await handleChatSelectCallback(ctx, clientId);
    return;
  }
  await next();
});

bot.on("callback_query:data", callbackRouter);

// DISABLED: photo storage removed
// bot.on("message:photo", async (ctx) => {
//   if (ctx.state?.action === "photos") {
//     await handlePhotoMessage(ctx);
//     return;
//   }
// });

bot.on("message:text", async (ctx) => {
  if (ctx.state?.action === "exercise_log") {
    const result = await handleWizardInput(ctx);
    if (result.type === "expired") {
      await ctx.reply(t("wizard.wizard_expired", ctx.language));
    } else if (result.type === "completed" && result.nextExerciseIndex != null && ctx.client) {
      const workout = await getTodayWorkout(ctx.client);
      if (workout) {
        await showExercise(ctx, result.nextExerciseIndex, workout);
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

  if (ctx.state?.action === "checkin") {
    await handleCheckinInput(ctx);
    return;
  }

  if (ctx.state?.action === "pause") {
    await handlePauseInput(ctx);
    return;
  }

  const text = ctx.message?.text ?? "";
  if (text.startsWith("/")) return;

  const handled = await handleCoachIncoming(ctx);
  if (handled) return;

  await handleFreeTextMessage(ctx);
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
