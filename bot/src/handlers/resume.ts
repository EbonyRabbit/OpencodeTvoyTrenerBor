import type { MyContext } from "../bot.js";
import { t, type Language } from "../i18n/index.js";
import { setState, clearState } from "../state/machine.js";
import { getTodayDateStr, getTodayWorkout, formatWorkoutMessage, truncateMessage } from "../lib/workout-utils.js";
import { getActivePause, resumePlan, suggestStrategy, type ResumeStrategy, type PlanPause } from "../lib/plan-adjustment.js";
import { DEFAULT_TIMEZONE } from "../lib/constants.js";
import { daysBetween } from "../lib/date-utils.js";
import { InlineKeyboard } from "grammy";

const REASON_LABELS: Record<string, string> = {
  sick: "pause.reason_sick",
  vacation: "pause.reason_vacation",
  injury: "pause.reason_injury",
  personal: "pause.reason_personal",
  other: "pause.reason_other",
};

function getReasonLabel(reason: string | null, lang: Language): string {
  if (!reason) return "—";
  const key = REASON_LABELS[reason];
  return key ? t(key, lang) : reason;
}

function getStrategyLabel(strategy: ResumeStrategy, lang: Language): string {
  return t(`resume.strategy_${strategy}`, lang);
}

function buildPauseInfo(pause: PlanPause, lang: Language, timezone: string): string {
  const todayStr = getTodayDateStr(timezone);
  const days = daysBetween(pause.pause_start, todayStr);
  const reason = getReasonLabel(pause.reason, lang);

  if (pause.planned_resume_date) {
    return t("resume.pause_info", lang, {
      days,
      reason,
      resume_date: pause.planned_resume_date,
    });
  }
  return t("resume.pause_info_no_date", lang, { days, reason });
}

function buildStrategyKeyboard(suggested: ResumeStrategy, lang: Language, pauseDurationDays: number): InlineKeyboard {
  const strategies: ResumeStrategy[] = ["skip", "shift", "deload", "rollback"];

  const keyboard = new InlineKeyboard();
  for (const s of strategies) {
    const label = s === "shift"
      ? t(`resume.strategy_${s}`, lang, { days: pauseDurationDays })
      : t(`resume.strategy_${s}`, lang);
    const suffix = s === suggested ? " ✓" : "";
    keyboard.text(`${label}${suffix}`, `resume:${s}`);
  }
  keyboard.text(t("resume.cancelled", lang), "resume:cancel");
  return keyboard;
}

export async function startResume(ctx: MyContext): Promise<void> {
  if (!ctx.from?.id) {
    await ctx.reply(t("error.user_not_identified", ctx.language));
    return;
  }

  const client = ctx.client;
  if (!client) {
    await ctx.reply(t("error.user_not_identified", ctx.language));
    return;
  }

  const lang = (client.language || "ru") as Language;

  const pause = await getActivePause(client.id);
  if (!pause) {
    await ctx.reply(t("resume.no_active_pause", lang));
    return;
  }

  if (pause.status === "resuming") {
    await ctx.reply(t("resume.already_resuming", lang));
    return;
  }

  const tz = client.timezone || DEFAULT_TIMEZONE;
  const todayStr = getTodayDateStr(tz);
  const pauseDuration = daysBetween(pause.pause_start, todayStr);
  const suggested = suggestStrategy(pauseDuration);

  const info = buildPauseInfo(pause, lang, tz);
  const suggestedLabel = getStrategyLabel(suggested, lang);
  const keyboard = buildStrategyKeyboard(suggested, lang, pauseDuration);

  try {
    await setState(ctx.from.id, {
      action: "resume",
      step: "strategy",
      data: {
        pause_id: pause.id,
        suggested,
      },
    });
  } catch (err) {
    console.error(`[RESUME] setState failed for ${ctx.from.id}:`, err);
    await ctx.reply(t("error.service_unavailable", lang));
    return;
  }

  await ctx.reply(t("resume.title", lang));
  await ctx.reply(info);
  await ctx.reply(t("resume.suggested_strategy", lang, { strategy: suggestedLabel }));
  await ctx.reply(t("resume.step_strategy", lang), { reply_markup: keyboard });
}

export async function handleResumeCallback(ctx: MyContext, strategyParam: string): Promise<void> {
  if (!ctx.from?.id || !ctx.state || ctx.state.action !== "resume" || !ctx.client) {
    await ctx.answerCallbackQuery();
    return;
  }

  const client = ctx.client;
  const lang = (client.language || "ru") as Language;
  const data = ctx.state.data as { pause_id?: string; suggested?: ResumeStrategy };
  const strategy = strategyParam as ResumeStrategy | "cancel";

  await ctx.answerCallbackQuery();

  if (strategy === "cancel") {
    await clearState(ctx.from.id);
    await ctx.editMessageText(t("resume.cancelled", lang));
    return;
  }

  const validStrategies: ResumeStrategy[] = ["skip", "shift", "deload", "rollback"];
  if (!validStrategies.includes(strategy)) {
    return;
  }

  if (!data.pause_id) {
    await clearState(ctx.from.id);
    await ctx.reply(t("resume.error", lang));
    return;
  }

  await clearState(ctx.from.id);

  const tz = client.timezone || DEFAULT_TIMEZONE;
  const todayStr = getTodayDateStr(tz);

  const result = await resumePlan(client.id, todayStr, strategy);

  if (result.error) {
    await ctx.reply(t("resume.error", lang));
    return;
  }

  const strategyLabel = getStrategyLabel(strategy, lang);
  await ctx.reply(`${t("resume.confirmed", lang)}\n${t("resume.suggested_strategy", lang, { strategy: strategyLabel })}`);

  try {
    const workout = await getTodayWorkout(client, lang);
    const header = t("resume.resumed_header", lang);
    const msg = workout
      ? `${header}\n\n${await formatWorkoutMessage(workout, lang, client)}`
      : `${header}\n\n${t("resume.no_workout_today", lang)}`;
    const truncated = truncateMessage(msg, t("program.truncation_suffix", lang));
    await ctx.reply(truncated);
  } catch (err) {
    console.warn(`[RESUME] Failed to send today's workout:`, err);
  }

  try {
    const bot = (await import("../bot.js")).bot;
    const coachChatId = (await import("../config.js")).config.coachChatId;
    if (coachChatId) {
      const coachMsg = `▶️ Клиент ${client.name ?? client.id} возобновил тренировки (стратегия: ${strategyLabel})`;
      await bot.api.sendMessage(String(coachChatId), coachMsg);
    }
  } catch (err) {
    console.warn(`[RESUME] Failed to notify coach:`, err);
  }
}
