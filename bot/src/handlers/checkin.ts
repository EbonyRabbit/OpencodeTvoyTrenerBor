import type { MyContext } from "../bot.js";
import { t, type Language } from "../i18n/index.js";
import { setState, clearState } from "../state/machine.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { config } from "../config.js";
import { type Client } from "../lib/clients.js";
import { getTodayDateStr } from "../lib/workout-utils.js";
import { DEFAULT_TIMEZONE } from "../lib/constants.js";
import {
  parseScale1to10,
  parseHours,
  parsePercentage,
  parseCount,
} from "../lib/wizard-validators.js";

const CHECKIN_STEPS = [
  "wellbeing",
  "sleep",
  "stress",
  "adherence",
  "missed_workouts",
  "complaints",
  "comment",
] as const;

type CheckinStep = (typeof CHECKIN_STEPS)[number];

interface CheckinData {
  wellbeing?: string;
  sleep?: string;
  stress?: string;
  adherence?: string;
  missed_workouts?: string;
  complaints?: string;
  comment?: string;
}

const STEP_INDEX = new Map<CheckinStep, number>(
  CHECKIN_STEPS.map((s, i) => [s, i]),
);

const STEP_VALIDATORS: Record<string, (input: string) => string | null> = {
  wellbeing: parseScale1to10,
  sleep: parseHours,
  stress: parseScale1to10,
  adherence: parsePercentage,
  missed_workouts: parseCount,
};

function getStepPrompt(step: CheckinStep, lang: Language): string {
  const promptKey = `checkin.step_${step}` as `checkin.step_${CheckinStep}`;
  const hintKey = `checkin.hint_${step}` as `checkin.hint_${CheckinStep}`;
  const prompt = t(promptKey, lang);
  const hint = t(hintKey, lang);
  return `${prompt}\n${hint}`;
}

function getNextStep(current: CheckinStep): CheckinStep | null {
  const idx = STEP_INDEX.get(current);
  if (idx == null || idx >= CHECKIN_STEPS.length - 1) return null;
  return CHECKIN_STEPS[idx + 1];
}

function buildSummary(data: CheckinData, lang: Language): string {
  const labels: [keyof CheckinData, string][] = [
    ["wellbeing", "checkin.summary_wellbeing"],
    ["sleep", "checkin.summary_sleep"],
    ["stress", "checkin.summary_stress"],
    ["adherence", "checkin.summary_adherence"],
    ["missed_workouts", "checkin.summary_missed"],
    ["complaints", "checkin.summary_complaints"],
    ["comment", "checkin.summary_comment"],
  ];

  return labels
    .filter(([key]) => data[key])
    .map(([key, labelKey]) => `${t(labelKey, lang)}: ${data[key]}`)
    .join("\n");
}

export async function startCheckin(ctx: MyContext): Promise<void> {
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

  try {
    await setState(ctx.from.id, {
      action: "checkin",
      step: "wellbeing",
      data: {},
    });
  } catch (err) {
    console.error(`[CHECKIN] setState failed for ${ctx.from.id}:`, err);
    await ctx.reply(t("error.service_unavailable", lang));
    return;
  }

  await ctx.reply(`${t("checkin.title", lang)}\n\n${getStepPrompt("wellbeing", lang)}`);
}

export async function handleCheckinInput(ctx: MyContext): Promise<void> {
  const client = ctx.client;
  if (!client || !ctx.from?.id) {
    await ctx.reply(t("error.user_not_identified", ctx.language));
    return;
  }

  const state = ctx.state;
  if (!state || state.action !== "checkin" || !state.step) return;

  if (!STEP_INDEX.has(state.step as CheckinStep)) {
    await ctx.reply(t("error.service_unavailable", ctx.language));
    await clearState(ctx.from.id);
    return;
  }

  const lang = (client.language || "ru") as Language;
  const currentStep = state.step as CheckinStep;
  const text = ctx.message?.text?.trim();

  const isOptional = currentStep === "complaints" || currentStep === "comment";

  if (text === "/skip") {
    if (!isOptional) {
      await ctx.reply(t("checkin.invalid_scale", lang));
      return;
    }

    const nextStep = getNextStep(currentStep);
    if (!nextStep) {
      await completeCheckin(ctx, client, state.data as CheckinData, lang);
      return;
    }

    try {
      await setState(ctx.from.id, {
        action: "checkin",
        step: nextStep,
        data: state.data,
      });
    } catch (err) {
      console.error(`[CHECKIN] setState failed for ${ctx.from.id}:`, err);
      await ctx.reply(t("error.service_unavailable", lang));
      return;
    }

    await ctx.reply(getStepPrompt(nextStep, lang));
    return;
  }

  if (isOptional) {
    const data = { ...(state.data as CheckinData), [currentStep]: text || "" };
    const nextStep = getNextStep(currentStep);
    if (!nextStep) {
      await completeCheckin(ctx, client, data, lang);
      return;
    }

    try {
      await setState(ctx.from.id, {
        action: "checkin",
        step: nextStep,
        data,
      });
    } catch (err) {
      console.error(`[CHECKIN] setState failed for ${ctx.from.id}:`, err);
      await ctx.reply(t("error.service_unavailable", lang));
      return;
    }

    await ctx.reply(getStepPrompt(nextStep, lang));
    return;
  }

  const validator = STEP_VALIDATORS[currentStep];
  if (!validator) {
    await ctx.reply(t("error.service_unavailable", lang));
    return;
  }

  const parsed = validator(text || "");
  if (!parsed) {
    const errorKey = currentStep === "sleep"
      ? "checkin.invalid_hours"
      : currentStep === "adherence"
        ? "checkin.invalid_percentage"
        : currentStep === "missed_workouts"
          ? "checkin.invalid_count"
          : "checkin.invalid_scale";
    await ctx.reply(t(errorKey, lang));
    return;
  }

  const data = { ...(state.data as CheckinData), [currentStep]: parsed };
  const nextStep = getNextStep(currentStep);

  if (!nextStep) {
    await completeCheckin(ctx, client, data, lang);
    return;
  }

  try {
    await setState(ctx.from.id, {
      action: "checkin",
      step: nextStep,
      data,
    });
  } catch (err) {
    console.error(`[CHECKIN] setState failed for ${ctx.from.id}:`, err);
    await ctx.reply(t("error.service_unavailable", lang));
    return;
  }

  await ctx.reply(getStepPrompt(nextStep, lang));
}

async function completeCheckin(
  ctx: MyContext,
  client: Client,
  data: CheckinData,
  lang: Language,
): Promise<void> {
  try {
    const tz = client.timezone || DEFAULT_TIMEZONE;
    const todayStr = getTodayDateStr(tz);

    const week = await getCurrentWeek(client);

    const logEntry = {
      client_id: client.id,
      date: todayStr,
      week,
      wellbeing: data.wellbeing ? Number(data.wellbeing) : null,
      sleep: data.sleep ? Number(data.sleep) : null,
      stress: data.stress ? Number(data.stress) : null,
      nutrition_adherence: data.adherence ? Number(data.adherence) : null,
      missed_workouts: data.missed_workouts ? Number(data.missed_workouts) : null,
      complaints: data.complaints || null,
      comment: data.comment || null,
    };

    const { error } = await supabaseAdmin
      .from("checkins")
      .insert(logEntry as never);

    if (error) {
      console.error(`[CHECKIN] Failed to save checkin for ${client.id}:`, error);
      await ctx.reply(t("error.service_unavailable", lang));
      return;
    }

    const summary = buildSummary(data, lang);
    await ctx.reply(`${t("checkin.saved", lang)}\n\n${t("checkin.summary", lang, { data: summary })}`);

    await notifyCoach(client, data, lang);
  } catch (err) {
    console.error(`[CHECKIN] Error completing checkin for ${client.id}:`, err);
    await ctx.reply(t("error.service_unavailable", lang));
  } finally {
    try {
      await clearState(ctx.from!.id);
    } catch (err) {
      console.error(`[CHECKIN] clearState failed:`, err);
    }
  }
}

async function notifyCoach(
  client: Client,
  data: CheckinData,
  lang: Language,
): Promise<void> {
  try {
    const coachChatId = Number(config.coachChatId);
    if (!coachChatId) return;

    const lines: string[] = [
      `📋 Чек-ин от ${client.name || client.id}`,
      "",
      `Самочувствие: ${data.wellbeing ?? "—"}`,
      `Сон: ${data.sleep ?? "—"}`,
      `Стресс: ${data.stress ?? "—"}`,
      `Придержание: ${data.adherence ?? "—"}%`,
      `Пропущено: ${data.missed_workouts ?? "—"}`,
    ];

    if (data.complaints) lines.push(`Жалобы: ${data.complaints}`);
    if (data.comment) lines.push(`Комментарий: ${data.comment}`);

    const bot = (await import("../bot.js")).bot;
    await bot.api.sendMessage(coachChatId, lines.join("\n"));
  } catch (err) {
    console.warn(`[CHECKIN] Failed to notify coach:`, err);
  }
}

async function getCurrentWeek(client: Client): Promise<number | null> {
  if (!client.program_id) return null;

  const tz = client.timezone || DEFAULT_TIMEZONE;
  const todayStr = getTodayDateStr(tz);

  const { data } = await supabaseAdmin
    .from("program_schedule")
    .select("week_number")
    .eq("client_id", client.id)
    .lte("start_date", todayStr)
    .gte("end_date", todayStr)
    .limit(1)
    .single();

  return data?.week_number ?? null;
}
