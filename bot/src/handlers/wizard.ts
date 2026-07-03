import type { MyContext } from "../bot.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import type { TodayWorkout } from "../lib/workout-utils.js";
import { getTodayDateStr } from "../lib/workout-utils.js";
import { parseSets, parseReps, parseWeight, parseRpe } from "../lib/wizard-validators.js";
import { t, type Language } from "../i18n/index.js";
import { setState, clearState } from "../state/machine.js";
import { markAsSent } from "../cron/dedup.js";

const DEFAULT_TIMEZONE = "Europe/Moscow";

export interface WizardData {
  exercise_index: number;
  exercise_name: string;
  week_number: number;
  day_name: string;
  exercise_count: number;
  sets?: string;
  reps?: string;
  weight?: string;
  rpe?: string;
  comment?: string;
}

export interface WizardResult {
  type: "next_step" | "completed" | "expired";
  nextExerciseIndex?: number;
  summary?: string;
}

const WIZARD_STEPS = ["sets", "reps", "weight", "rpe", "comment"] as const;
type WizardStep = (typeof WIZARD_STEPS)[number];

function getStepIndex(step: string): number {
  return WIZARD_STEPS.indexOf(step as WizardStep);
}

function getNextStep(currentStep: string): WizardStep | null {
  const idx = getStepIndex(currentStep);
  if (idx < 0 || idx >= WIZARD_STEPS.length - 1) return null;
  return WIZARD_STEPS[idx + 1];
}

function getStepPrompt(step: WizardStep, lang: Language): { text: string; hint: string; required: boolean } {
  switch (step) {
    case "sets":
      return { text: t("wizard.step_sets", lang), hint: t("wizard.step_sets_hint", lang), required: true };
    case "reps":
      return { text: t("wizard.step_reps", lang), hint: t("wizard.step_reps_hint", lang), required: true };
    case "weight":
      return { text: t("wizard.step_weight", lang), hint: t("wizard.step_weight_hint", lang), required: false };
    case "rpe":
      return { text: t("wizard.step_rpe", lang), hint: t("wizard.step_rpe_hint", lang), required: false };
    case "comment":
      return { text: t("wizard.step_comment", lang), hint: t("wizard.step_comment_hint", lang), required: false };
  }
}

function validateStep(step: WizardStep, input: string): string | null {
  switch (step) {
    case "sets": return parseSets(input);
    case "reps": return parseReps(input);
    case "weight": return parseWeight(input);
    case "rpe": return parseRpe(input);
    case "comment": return input.trim() || null;
  }
}

function buildSummary(data: WizardData, lang: Language): string {
  return t("wizard.logged_summary", lang, {
    exercise: data.exercise_name,
    sets: data.sets ?? "-",
    reps: data.reps ?? "-",
    weight_line: data.weight ? `${t("wizard.summary_weight", lang, { weight: data.weight })}\n` : "",
    rpe_line: data.rpe ? `${t("wizard.summary_rpe", lang, { rpe: data.rpe })}\n` : "",
    comment_line: data.comment ? `${t("wizard.summary_comment", lang, { comment: data.comment })}` : "",
  });
}

export async function startExerciseLogging(
  ctx: MyContext,
  exerciseIndex: number,
  workout: TodayWorkout,
): Promise<void> {
  if (!ctx.from?.id) {
    await ctx.reply(t("error.user_not_identified", ctx.language));
    return;
  }

  const exercise = workout.exercises[exerciseIndex];
  if (!exercise) {
    await ctx.reply(t("error.invalid_exercise_index", ctx.language));
    return;
  }

  const data: WizardData = {
    exercise_index: exerciseIndex,
    exercise_name: exercise.name,
    week_number: workout.week_number,
    day_name: workout.day_name,
    exercise_count: workout.exercises.length,
  };

  await setState(ctx.from.id, {
    action: "exercise_log",
    step: "sets",
    data: data as unknown as Record<string, unknown>,
  });

  const prompt = getStepPrompt("sets", ctx.language);
  await ctx.reply(`${prompt.text}\n${prompt.hint}`);
}

export async function handleWizardInput(ctx: MyContext): Promise<WizardResult> {
  if (!ctx.state || ctx.state.action !== "exercise_log" || !ctx.from?.id) {
    return { type: "expired" };
  }

  const currentStep = ctx.state.step as WizardStep | null;
  if (!currentStep || !WIZARD_STEPS.includes(currentStep)) {
    return { type: "expired" };
  }

  const text = ctx.message?.text?.trim();
  if (!text) return { type: "expired" };

  if (text === "/skip") {
    const stepInfo = getStepPrompt(currentStep, ctx.language);
    if (stepInfo.required) {
      await ctx.reply(t("wizard.invalid_input", ctx.language));
      return { type: "next_step" };
    }
    return await advanceWizard(ctx, currentStep, null);
  }

  const validated = validateStep(currentStep, text);
  if (validated === null) {
    await ctx.reply(t("wizard.invalid_input", ctx.language));
    return { type: "next_step" };
  }

  return await advanceWizard(ctx, currentStep, validated);
}

export async function handleWizardSkip(ctx: MyContext, _params: string): Promise<void> {
  if (!ctx.state || ctx.state.action !== "exercise_log" || !ctx.from?.id) {
    await ctx.answerCallbackQuery({ text: t("wizard.wizard_expired", ctx.language), show_alert: true }).catch(() => {});
    return;
  }

  const currentStep = ctx.state.step as WizardStep | null;
  if (!currentStep || !WIZARD_STEPS.includes(currentStep)) {
    await ctx.answerCallbackQuery({ text: t("wizard.wizard_expired", ctx.language), show_alert: true }).catch(() => {});
    return;
  }

  const stepInfo = getStepPrompt(currentStep, ctx.language);
  if (stepInfo.required) {
    await ctx.answerCallbackQuery({ text: t("wizard.invalid_input", ctx.language), show_alert: true }).catch(() => {});
    return;
  }

  await ctx.answerCallbackQuery().catch(() => {});
  const result = await advanceWizard(ctx, currentStep, null);

  if (result.type === "completed" && result.nextExerciseIndex != null && ctx.client) {
    const { getTodayWorkout } = await import("../lib/workout-utils.js");
    const workout = await getTodayWorkout(ctx.client);
    if (workout) {
      await startExerciseLogging(ctx, result.nextExerciseIndex, workout);
    }
  }
}

async function advanceWizard(
  ctx: MyContext,
  currentStep: WizardStep,
  value: string | null,
): Promise<WizardResult> {
  if (!ctx.from?.id) return { type: "expired" };

  const data = (ctx.state?.data ?? {}) as unknown as WizardData;
  if (value !== null) {
    (data as unknown as Record<string, unknown>)[currentStep] = value;
  }

  const nextStep = getNextStep(currentStep);

  if (!nextStep) {
    return await completeWizard(ctx, data);
  }

  await setState(ctx.from.id, {
    action: "exercise_log",
    step: nextStep,
    data: data as unknown as Record<string, unknown>,
  });

  const prompt = getStepPrompt(nextStep, ctx.language);
  const skipButton = prompt.required
    ? []
    : [[{ text: t("wizard.skip_step", ctx.language), callback_data: `wizard_skip:${nextStep}` }]];

  await ctx.reply(`${prompt.text}\n${prompt.hint}`, {
    reply_markup: skipButton.length > 0 ? { inline_keyboard: skipButton } : undefined,
  });

  return { type: "next_step" };
}

async function completeWizard(ctx: MyContext, data: WizardData): Promise<WizardResult> {
  if (!ctx.from?.id || !ctx.client) return { type: "expired" };

  const tz = ctx.client.timezone || DEFAULT_TIMEZONE;
  const todayStr = getTodayDateStr(tz);

  const { error } = await supabaseAdmin.from("workout_logs").insert({
    client_id: ctx.client.id,
    date: todayStr,
    week: data.week_number,
    exercise: data.exercise_name,
    sets: data.sets ? Number(data.sets) : null,
    reps: data.reps ?? null,
    weight: data.weight ? Number(data.weight) : null,
    rpe: data.rpe ? Number(data.rpe) : null,
    comment: data.comment || null,
  });

  if (error) {
    console.error(`[WIZARD] Insert error for ${ctx.from.id}:`, error.message);
    await ctx.reply(t("error.service_unavailable", ctx.language));
    await clearState(ctx.from.id).catch(() => {});
    return { type: "expired" };
  }

  const dedupResult = await markAsSent(`workout_completed:${ctx.client.id}:${todayStr}`);
  if (dedupResult === "error") {
    console.warn(`[WIZARD] Dedup write failed for ${ctx.client.id}`);
  }

  const summary = buildSummary(data, ctx.language);
  await ctx.reply(summary);

  try {
    await clearState(ctx.from.id);
  } catch (err) {
    console.warn(`[WIZARD] clearState failed for ${ctx.from.id}:`, err);
  }

  const nextIndex = data.exercise_index + 1;
  if (nextIndex < data.exercise_count) {
    return { type: "completed", nextExerciseIndex: nextIndex, summary };
  }

  await ctx.reply(t("wizard.all_done", ctx.language));
  return { type: "completed" };
}
