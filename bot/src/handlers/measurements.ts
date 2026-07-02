import type { MyContext } from "../bot.js";
import { t, type Language } from "../i18n/index.js";
import { setState, clearState } from "../state/machine.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { parseMeasurement } from "../lib/wizard-validators.js";
import { getTodayDateStr } from "../lib/workout-utils.js";
import { type Client } from "../lib/clients.js";

const MEASUREMENT_STEPS = [
  "weight",
  "waist",
  "abdomen",
  "chest",
  "hips",
  "glutes",
  "left_thigh",
  "right_thigh",
  "left_arm",
  "right_arm",
  "body_fat",
  "muscle_mass",
  "visceral_fat",
  "comment",
] as const;

type MeasurementStep = (typeof MEASUREMENT_STEPS)[number];

interface MeasurementData {
  weight?: string;
  waist?: string;
  abdomen?: string;
  chest?: string;
  hips?: string;
  glutes?: string;
  left_thigh?: string;
  right_thigh?: string;
  left_arm?: string;
  right_arm?: string;
  body_fat?: string;
  muscle_mass?: string;
  visceral_fat?: string;
  comment?: string;
}

const STEP_INDEX = new Map<MeasurementStep, number>(
  MEASUREMENT_STEPS.map((s, i) => [s, i]),
);

function getStepPrompt(step: MeasurementStep, lang: Language): string {
  const promptKey = `measure.step_${step}` as `measure.step_${MeasurementStep}`;
  const hintKey = `measure.hint_${step}` as `measure.hint_${MeasurementStep}`;
  const prompt = t(promptKey, lang);
  const hint = t(hintKey, lang);
  return `${prompt}\n${hint}\n\n💡 /skip — пропустить`;
}

function getNextStep(current: MeasurementStep): MeasurementStep | null {
  const idx = STEP_INDEX.get(current);
  if (idx == null || idx >= MEASUREMENT_STEPS.length - 1) return null;
  return MEASUREMENT_STEPS[idx + 1];
}

function buildSummary(data: MeasurementData, lang: Language): string {
  const lines: string[] = [];
  const labels: [keyof MeasurementData, string][] = [
    ["weight", "measure.step_weight"],
    ["waist", "measure.step_waist"],
    ["abdomen", "measure.step_abdomen"],
    ["chest", "measure.step_chest"],
    ["hips", "measure.step_hips"],
    ["glutes", "measure.step_glutes"],
    ["left_thigh", "measure.step_left_thigh"],
    ["right_thigh", "measure.step_right_thigh"],
    ["left_arm", "measure.step_left_arm"],
    ["right_arm", "measure.step_right_arm"],
    ["body_fat", "measure.step_body_fat"],
    ["muscle_mass", "measure.step_muscle_mass"],
    ["visceral_fat", "measure.step_visceral_fat"],
  ];

  for (const [key, labelKey] of labels) {
    const val = data[key];
    if (val) {
      lines.push(`${t(labelKey, lang)}: ${val}`);
    }
  }

  if (data.comment) {
    lines.push(`${t("measure.step_comment", lang)}: ${data.comment}`);
  }

  return lines.join("\n");
}

export async function startMeasurements(ctx: MyContext): Promise<void> {
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
      action: "measurements",
      step: "weight",
      data: {},
    });
  } catch (err) {
    console.error(`[MEASURE] setState failed for ${ctx.from.id}:`, err);
    await ctx.reply(t("error.service_unavailable", lang));
    return;
  }

  await ctx.reply(`${t("measure.title", lang)}\n\n${getStepPrompt("weight", lang)}`);
}

export async function handleMeasurementsInput(ctx: MyContext): Promise<void> {
  const client = ctx.client;
  if (!client || !ctx.from?.id) {
    await ctx.reply(t("error.user_not_identified", ctx.language));
    return;
  }

  const state = ctx.state;
  if (!state || state.action !== "measurements" || !state.step) return;

  if (!STEP_INDEX.has(state.step as MeasurementStep)) {
    await ctx.reply(t("error.service_unavailable", ctx.language));
    await clearState(ctx.from.id);
    return;
  }

  const lang = (client.language || "ru") as Language;
  const currentStep = state.step as MeasurementStep;
  const text = ctx.message?.text?.trim();

  if (text === "/skip") {
    const nextStep = getNextStep(currentStep);
    if (!nextStep) {
      await completeMeasurements(ctx, client, state.data as MeasurementData, lang);
      return;
    }

    try {
      await setState(ctx.from.id, {
        action: "measurements",
        step: nextStep,
        data: state.data,
      });
    } catch (err) {
      console.error(`[MEASURE] setState failed for ${ctx.from.id}:`, err);
      await ctx.reply(t("error.service_unavailable", lang));
      return;
    }

    await ctx.reply(getStepPrompt(nextStep, lang));
    return;
  }

  if (currentStep === "comment") {
    const data = { ...(state.data as MeasurementData), comment: text || "" };
    await completeMeasurements(ctx, client, data, lang);
    return;
  }

  const parsed = parseMeasurement(text || "");
  if (!parsed) {
    await ctx.reply(t("measure.invalid_number", lang));
    return;
  }

  const data = { ...(state.data as MeasurementData), [currentStep]: parsed };
  const nextStep = getNextStep(currentStep);

  if (!nextStep) {
    await completeMeasurements(ctx, client, data, lang);
    return;
  }

  try {
    await setState(ctx.from.id, {
      action: "measurements",
      step: nextStep,
      data,
    });
  } catch (err) {
    console.error(`[MEASURE] setState failed for ${ctx.from.id}:`, err);
    await ctx.reply(t("error.service_unavailable", lang));
    return;
  }

  await ctx.reply(getStepPrompt(nextStep, lang));
}

async function completeMeasurements(
  ctx: MyContext,
  client: Client,
  data: MeasurementData,
  lang: Language,
): Promise<void> {
  try {
    const tz = client.timezone || "Europe/Moscow";
    const todayStr = getTodayDateStr(tz);

    const logEntry = {
      client_id: client.id,
      date: todayStr,
      weight: data.weight ? Number(data.weight) : null,
      waist: data.waist ? Number(data.waist) : null,
      abdomen: data.abdomen ? Number(data.abdomen) : null,
      chest: data.chest ? Number(data.chest) : null,
      hips: data.hips ? Number(data.hips) : null,
      glutes: data.glutes ? Number(data.glutes) : null,
      left_thigh: data.left_thigh ? Number(data.left_thigh) : null,
      right_thigh: data.right_thigh ? Number(data.right_thigh) : null,
      left_arm: data.left_arm ? Number(data.left_arm) : null,
      right_arm: data.right_arm ? Number(data.right_arm) : null,
      body_fat: data.body_fat ? Number(data.body_fat) : null,
      muscle_mass: data.muscle_mass ? Number(data.muscle_mass) : null,
      visceral_fat: data.visceral_fat ? Number(data.visceral_fat) : null,
      comment: data.comment || null,
    };

    const { error } = await supabaseAdmin
      .from("measurements")
      .upsert(logEntry, { onConflict: "client_id,date" });

    if (error) {
      console.error(`[MEASURE] Failed to save measurements for ${client.id}:`, error);
      await ctx.reply(t("error.service_unavailable", lang));
      return;
    }

    const summary = buildSummary(data, lang);
    await ctx.reply(`${t("measure.saved", lang)}\n\n${t("measure.summary", lang, { data: summary })}`);
  } catch (err) {
    console.error(`[MEASURE] Error completing measurements for ${client.id}:`, err);
    await ctx.reply(t("error.service_unavailable", lang));
  } finally {
    try {
      await clearState(ctx.from!.id);
    } catch (err) {
      console.error(`[MEASURE] clearState failed:`, err);
    }
  }
}
