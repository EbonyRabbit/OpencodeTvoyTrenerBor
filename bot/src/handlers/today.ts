import type { MyContext } from "../bot.js";
import { guardActiveClient } from "./guards.js";
import { sendTodayWorkout } from "../lib/workout-utils.js";
import { t } from "../i18n/index.js";

export async function todayHandler(ctx: MyContext): Promise<void> {
  const telegramId = ctx.from?.id;

  if (!telegramId) {
    await ctx.reply(t("error.user_not_identified", ctx.language));
    return;
  }

  try {
    const guard = await guardActiveClient(ctx);
    if (typeof guard === "string") {
      await ctx.reply(guard);
      return;
    }

    await sendTodayWorkout(ctx, guard.client, telegramId);
  } catch (err) {
    console.error(`[TODAY] Error for ${telegramId}:`, err);
    try {
      await ctx.reply(t("error.service_unavailable", ctx.language));
    } catch {
      // fallback reply failed
    }
  }
}
