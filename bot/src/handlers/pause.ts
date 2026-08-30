import type { MyContext } from "../bot.js";
import { t, type Language } from "../i18n/index.js";
import { setState, clearState } from "../state/machine.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { type Client } from "../lib/clients.js";
import { getTodayDateStr } from "../lib/workout-utils.js";
import { parsePauseReason, parseDate } from "../lib/wizard-validators.js";
import { createPause, getActivePause, type PauseReason } from "../lib/plan-adjustment.js";
import { DEFAULT_TIMEZONE } from "../lib/constants.js";

const PAUSE_STEPS = ["reason", "resume_date"] as const;

type PauseStep = (typeof PAUSE_STEPS)[number];

interface PauseData {
  reason?: string;
  resume_date?: string;
}

const STEP_INDEX = new Map<PauseStep, number>(
  PAUSE_STEPS.map((s, i) => [s, i]),
);

function getStepPrompt(step: PauseStep, lang: Language): string {
  const promptKey = `pause.step_${step}` as `pause.step_${PauseStep}`;
  const hintKey = `pause.hint_${step}` as `pause.hint_${PauseStep}`;
  const prompt = t(promptKey, lang);
  const hint = t(hintKey, lang);
  return `${prompt}\n${hint}`;
}

function getNextStep(current: PauseStep): PauseStep | null {
  const idx = STEP_INDEX.get(current);
  if (idx == null || idx >= PAUSE_STEPS.length - 1) return null;
  return PAUSE_STEPS[idx + 1];
}

function getReasonLabel(reason: string, lang: Language): string {
  return t(`pause.reason_${reason}`, lang);
}

function buildSummary(data: PauseData, lang: Language): string {
  const reason = data.reason ? getReasonLabel(data.reason, lang) : "-";
  if (data.resume_date) {
    return t("pause.summary", lang, { reason, resume_date: data.resume_date });
  }
  return t("pause.summary_no_date", lang, { reason });
}

export async function startPause(ctx: MyContext): Promise<void> {
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

  const existing = await getActivePause(client.id);
  if (existing) {
    await ctx.reply(t("pause.already_active", lang));
    return;
  }

  try {
    await setState(ctx.from.id, {
      action: "pause",
      step: "reason",
      data: {},
    });
  } catch (err) {
    console.error(`[PAUSE] setState failed for ${ctx.from.id}:`, err);
    await ctx.reply(t("error.service_unavailable", lang));
    return;
  }

  await ctx.reply(t("pause.title", lang));
  await ctx.reply(getStepPrompt("reason", lang));
}

export async function handlePauseInput(ctx: MyContext): Promise<void> {
  if (!ctx.from?.id || !ctx.state || ctx.state.action !== "pause" || !ctx.client) return;

  const client = ctx.client;
  const lang = (client.language || "ru") as Language;
  const currentStep = ctx.state.step as PauseStep;
  const text = ctx.message?.text?.trim();

  if (!text) {
    await ctx.reply(t("wizard.invalid_input", lang));
    return;
  }

  if (text === "/cancel") {
    await clearState(ctx.from.id);
    await ctx.reply(t("pause.cancelled", lang));
    return;
  }

  const data = { ...(ctx.state.data as PauseData) };

  if (currentStep === "reason") {
    const reason = parsePauseReason(text);
    if (!reason) {
      await ctx.reply(t("pause.invalid_reason", lang));
      return;
    }
    data.reason = reason;
  } else if (currentStep === "resume_date") {
    if (text === "/skip") {
      data.resume_date = undefined;
    } else {
      const date = parseDate(text);
      if (!date) {
        await ctx.reply(t("pause.invalid_date", lang));
        return;
      }

      const tz = client.timezone || DEFAULT_TIMEZONE;
      const todayStr = getTodayDateStr(tz);
      if (date <= todayStr) {
        await ctx.reply(t("pause.past_date", lang));
        return;
      }

      data.resume_date = date;
    }
  }

  const nextStep = getNextStep(currentStep);

  if (nextStep) {
    await setState(ctx.from.id, {
      action: "pause",
      step: nextStep,
      data,
    });
    await ctx.reply(getStepPrompt(nextStep, lang));
  } else {
    await completePause(ctx, client, data, lang);
  }
}

async function completePause(
  ctx: MyContext,
  client: Client,
  data: PauseData,
  lang: Language,
): Promise<void> {
  try {
    const tz = client.timezone || DEFAULT_TIMEZONE;
    const todayStr = getTodayDateStr(tz);

    const result = await createPause(
      client.id,
      todayStr,
      data.reason as PauseReason,
      data.resume_date ?? null,
    );

    if (!result.ok) {
      if (result.code === "ALREADY_ACTIVE") {
        await ctx.reply(t("pause.already_active", lang));
      } else {
        await ctx.reply(t("error.service_unavailable", lang));
      }
      await clearState(ctx.from!.id);
      return;
    }

    await clearState(ctx.from!.id);
    const summary = buildSummary(data, lang);
    await ctx.reply(`${t("pause.saved", lang)}\n\n${summary}`);

    try {
      const bot = (await import("../bot.js")).bot;
      const coachChatId = (await import("../config.js")).config.coachChatId;
      if (coachChatId) {
        const coachMsg = `⏸ Пауза клиента ${client.name ?? client.id}:\n${summary}`;
        await bot.api.sendMessage(String(coachChatId), coachMsg);
      }
    } catch (err) {
      console.warn(`[PAUSE] Failed to notify coach:`, err);
    }
  } catch (err) {
    console.error(`[PAUSE] Error completing pause:`, err);
    await ctx.reply(t("error.service_unavailable", lang));
    try {
      await clearState(ctx.from!.id);
    } catch {
      // ignore
    }
  }
}
