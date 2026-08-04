import type { MyContext } from "../bot.js";
import { t, type Language } from "../i18n/index.js";
import { type Client } from "../lib/clients.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { getTodayWorkout, getTodayDateStr } from "../lib/workout-utils.js";
import { DEFAULT_TIMEZONE } from "../lib/constants.js";

export { DEFAULT_TIMEZONE };

async function handleEveningResponse(
  ctx: MyContext,
  response: "yes" | "no" | "postpone",
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
    await ctx.answerCallbackQuery({ text: noWorkoutMsg });
    await ctx.editMessageText(noWorkoutMsg);
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
    await ctx.answerCallbackQuery({ text: "Error" });
    return false;
  }

  const responseKey = `evening.response_${response}` as "evening.response_yes" | "evening.response_no" | "evening.response_postpone";
  const confirmation = t(responseKey, lang);

  await ctx.answerCallbackQuery({ text: confirmation });
  await ctx.editMessageText(`${t("evening.poll_question", lang)}\n\n${confirmation}`);

  return true;
}

export async function handleEveningYes(ctx: MyContext): Promise<boolean> {
  return handleEveningResponse(ctx, "yes");
}

export async function handleEveningNo(ctx: MyContext): Promise<boolean> {
  return handleEveningResponse(ctx, "no");
}

export async function handleEveningPostpone(ctx: MyContext): Promise<boolean> {
  return handleEveningResponse(ctx, "postpone");
}
