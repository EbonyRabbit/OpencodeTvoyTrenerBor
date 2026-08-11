import type { MyContext } from "../bot.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import type { TodayWorkout } from "../lib/workout-utils.js";
import { getTodayDateStr, getTodayWorkout, isTodayWorkoutCompleted, formatDuration } from "../lib/workout-utils.js";
import {
  parseSets,
  parseReps,
  parseWeight,
  parseRpe,
  parseDurationSec,
  parseDistanceKm,
  parsePace,
  parseHeartRate,
  parseRounds,
  roundsValue,
  heartRateValue,
  repsListMatchesSets,
} from "../lib/wizard-validators.js";
import type { ExerciseType, ParsedExercise } from "../lib/program-utils.js";
import { getCompositeLetters } from "../lib/program-utils.js";
import type { Database } from "../lib/types.js";
import { t, type Language } from "../i18n/index.js";
import { setState, clearState } from "../state/machine.js";
import { markAsSent } from "../cron/dedup.js";
import { DEFAULT_TIMEZONE } from "../lib/constants.js";

export interface ChildLogEntry {
  name: string;
  type: Exclude<ExerciseType, "superset" | "circuit">;
  letter?: string;
  sets?: string;
  reps?: string;
  weight?: string;
  rpe?: string;
  comment?: string;
  duration?: string;
  distance?: string;
  pace?: string;
  heart_rate?: string;
}

export interface WizardData {
  exercise_index: number;
  exercise_name: string;
  week_number: number;
  day_name: string;
  day_order: number | null;
  exercise_count: number;
  type: ExerciseType;
  child_index: number;
  child_count: number;
  children?: ChildLogEntry[];
  sets?: string;
  reps?: string;
  weight?: string;
  rpe?: string;
  comment?: string;
  duration?: string;
  distance?: string;
  pace?: string;
  heart_rate?: string;
  rounds?: string;
}

export interface WizardResult {
  type: "next_step" | "completed" | "expired" | "already_completed";
  nextExerciseIndex?: number;
}

type WizardStep =
  | "sets" | "reps" | "weight" | "rpe" | "comment"
  | "duration" | "distance" | "pace" | "heart_rate" | "rounds";

const STRENGTH_STEPS: WizardStep[] = ["sets", "reps", "weight", "rpe", "comment"];
const CARDIO_STEPS: WizardStep[] = ["duration", "distance", "pace", "heart_rate", "comment"];
const CIRCUIT_STEPS: WizardStep[] = ["rounds", "comment"];
const SUPERSET_PARENT_STEPS: WizardStep[] = ["sets"];
const SUPERSET_CHILD_STEPS: WizardStep[] = ["reps", "weight", "rpe", "comment"];

function getStepsForPosition(data: WizardData): WizardStep[] {
  switch (data.type) {
    case "cardio":
      return CARDIO_STEPS;
    case "circuit":
      return CIRCUIT_STEPS;
    case "superset":
      if (data.child_index < 0) {
        const children = data.children ?? [];
        const allCardio = children.length > 0 && children.every((c) => c.type === "cardio");
        return allCardio ? [] : SUPERSET_PARENT_STEPS;
      }
      return data.children?.[data.child_index]?.type === "cardio"
        ? CARDIO_STEPS
        : SUPERSET_CHILD_STEPS;
    default:
      return STRENGTH_STEPS;
  }
}

function getStepIndex(step: string, data: WizardData): number {
  return getStepsForPosition(data).indexOf(step as WizardStep);
}

function getNextStep(currentStep: string, data: WizardData): WizardStep | null {
  const steps = getStepsForPosition(data);
  const idx = steps.indexOf(currentStep as WizardStep);
  if (idx < 0 || idx >= steps.length - 1) return null;
  return steps[idx + 1];
}

function getStepPrompt(step: WizardStep, lang: Language): { text: string; hint: string; required: boolean } {
  switch (step) {
    case "sets":
      return { text: t("wizard.step_sets", lang), hint: t("wizard.step_sets_hint", lang), required: true };
    case "reps":
      return { text: t("wizard.step_reps", lang), hint: t("wizard.step_reps_hint", lang), required: true };
    case "weight":
      return { text: t("wizard.step_weight", lang), hint: t("wizard.step_weight_hint", lang), required: true };
    case "rpe":
      return { text: t("wizard.step_rpe", lang), hint: t("wizard.step_rpe_hint", lang), required: true };
    case "comment":
      return { text: t("wizard.step_comment", lang), hint: t("wizard.step_comment_hint", lang), required: false };
    case "duration":
      return { text: t("wizard.step_duration", lang), hint: t("wizard.step_duration_hint", lang), required: true };
    case "distance":
      return { text: t("wizard.step_distance", lang), hint: t("wizard.step_distance_hint", lang), required: true };
    case "pace":
      return { text: t("wizard.step_pace", lang), hint: t("wizard.step_pace_hint", lang), required: true };
    case "heart_rate":
      return { text: t("wizard.step_heart_rate", lang), hint: t("wizard.step_heart_rate_hint", lang), required: true };
    case "rounds":
      return { text: t("wizard.step_rounds", lang), hint: t("wizard.step_rounds_hint", lang), required: true };
  }
}

function validateStep(step: WizardStep, input: string): string | null {
  switch (step) {
    case "sets": return parseSets(input);
    case "reps": return parseReps(input);
    case "weight": return parseWeight(input);
    case "rpe": return parseRpe(input);
    case "comment": return input.trim() || null;
    case "duration": return parseDurationSec(input);
    case "distance": return parseDistanceKm(input);
    case "pace": return parsePace(input);
    case "heart_rate": return parseHeartRate(input);
    case "rounds": return parseRounds(input);
  }
}

function formatDurationLabel(sec: string, lang: Language): string {
  const num = Number(sec);
  if (!Number.isFinite(num) || num <= 0) return t("workout.metric_duration_seconds", lang, { seconds: sec });
  return formatDuration(num, lang);
}

function currentChildName(data: WizardData): string {
  const child = data.children?.[data.child_index];
  if (!child) return data.exercise_name;
  return child.letter ? `${child.letter}. ${child.name}` : child.name;
}

function buildSummary(data: WizardData, lang: Language): string {
  if (data.type === "superset" && data.children?.length) {
    const lines = data.children.map((child) => {
      const name = child.letter ? `${child.letter}. ${child.name}` : child.name;
      const parts: string[] = [];
      if (child.type === "cardio") {
        if (child.distance) parts.push(t("wizard.summary_distance", lang, { distance: child.distance }));
        if (child.duration) parts.push(t("wizard.summary_duration", lang, { duration: formatDurationLabel(child.duration, lang) }));
        if (child.pace) parts.push(t("wizard.summary_pace", lang, { pace: child.pace }));
        if (child.heart_rate) parts.push(t("wizard.summary_heart_rate", lang, { heart_rate: child.heart_rate }));
      } else {
        if (child.sets) parts.push(t("workout.exercise_sets_reps", lang, { sets: child.sets, reps: child.reps ?? "-" }));
        if (child.weight) parts.push(t("wizard.summary_weight", lang, { weight: child.weight }));
        if (child.rpe) parts.push(t("wizard.summary_rpe", lang, { rpe: child.rpe }));
      }
      if (child.comment) parts.push(t("wizard.summary_comment", lang, { comment: child.comment }));
      return `${name}: ${parts.join(", ")}`;
    });
    return `${t("wizard.superset_logged", lang, { exercise: data.exercise_name })}\n${lines.join("\n")}`;
  }

  if (data.type === "cardio") {
    const metrics: string[] = [];
    if (data.distance) metrics.push(`${t("wizard.summary_distance", lang, { distance: data.distance })}`);
    if (data.duration) metrics.push(t("wizard.summary_duration", lang, { duration: formatDurationLabel(data.duration, lang) }));
    if (data.pace) metrics.push(t("wizard.summary_pace", lang, { pace: data.pace }));
    if (data.heart_rate) metrics.push(t("wizard.summary_heart_rate", lang, { heart_rate: data.heart_rate }));
    const commentLine = data.comment ? `\n${t("wizard.summary_comment", lang, { comment: data.comment })}` : "";
    return t("wizard.logged_summary_cardio", lang, {
      exercise: data.exercise_name,
      metrics: metrics.join(" · "),
      comment_line: commentLine,
    });
  }

  if (data.type === "circuit") {
    const metrics: string[] = [];
    if (data.rounds) metrics.push(t("wizard.summary_rounds", lang, { rounds: data.rounds }));
    const commentLine = data.comment ? `\n${t("wizard.summary_comment", lang, { comment: data.comment })}` : "";
    return t("wizard.logged_summary_circuit", lang, {
      exercise: data.exercise_name,
      metrics: metrics.join(" · "),
      comment_line: commentLine,
    });
  }

  const weightLine =
    data.weight === "0"
      ? `${t("wizard.summary_bodyweight", lang)}\n`
      : data.weight
        ? `${t("wizard.summary_weight", lang, { weight: data.weight })}\n`
        : "";
  return t("wizard.logged_summary", lang, {
    exercise: data.exercise_name,
    sets: data.sets ?? "-",
    reps: data.reps ?? "-",
    weight_line: weightLine,
    rpe_line: data.rpe ? `${t("wizard.summary_rpe", lang, { rpe: data.rpe })}\n` : "",
    comment_line: data.comment ? `${t("wizard.summary_comment", lang, { comment: data.comment })}` : "",
  });
}

function buildChildTemplate(exercise: ParsedExercise, letter = "A"): ChildLogEntry[] {
  return (exercise.children ?? []).map((child, i) => ({
    name: child.name,
    type: child.type === "cardio" ? "cardio" : "strength",
    letter: `${letter}${i + 1}`,
  }));
}

function initialWizardStep(data: WizardData): WizardStep | null {
  let steps = getStepsForPosition(data);
  if (steps.length === 0) {
    data.child_index += 1;
    steps = getStepsForPosition(data);
  }
  return steps[0] ?? null;
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

  const type = (exercise.type ?? "strength") as ExerciseType;
  const childCount = type === "superset" ? (exercise.children?.length ?? 0) : 0;
  const compositeLetter = getCompositeLetters(workout.exercises).get(exerciseIndex) ?? "A";

  const data: WizardData = {
    exercise_index: exerciseIndex,
    exercise_name: exercise.name,
    week_number: workout.week_number,
    day_name: workout.day_name,
    day_order: workout.day_order,
    exercise_count: workout.exercises.length,
    type,
    child_index: -1,
    child_count: childCount,
    children: childCount > 0 ? buildChildTemplate(exercise, compositeLetter) : undefined,
  };

  const firstStep = initialWizardStep(data);
  if (!firstStep) {
    await ctx.reply(t("error.service_unavailable", ctx.language));
    return;
  }

  await setState(ctx.from.id, {
    action: "exercise_log",
    step: firstStep,
    data: data as unknown as Record<string, unknown>,
  });

  const prompt = getStepPrompt(firstStep, ctx.language);
  await ctx.reply(`${prompt.text}\n${prompt.hint}`);
}

export async function handleWizardInput(ctx: MyContext): Promise<WizardResult> {
  if (!ctx.state || ctx.state.action !== "exercise_log" || !ctx.from?.id) {
    return { type: "expired" };
  }

  const data = (ctx.state?.data ?? {}) as unknown as WizardData;
  const steps = getStepsForPosition(data);
  const currentStep = ctx.state.step as WizardStep | null;
  if (!currentStep || !steps.includes(currentStep)) {
    return { type: "expired" };
  }

  const text = ctx.message?.text?.trim();
  if (!text) return { type: "expired" };

  if (text === "/skip") {
    const stepInfo = getStepPrompt(currentStep, ctx.language);
    if (stepInfo.required) {
      await ctx.reply(t("wizard.step_required", ctx.language));
      return { type: "next_step" };
    }
    return await advanceWizard(ctx, currentStep, null);
  }

  const validated = validateStep(currentStep, text);
  if (validated === null) {
    await ctx.reply(t("wizard.invalid_input", ctx.language));
    return { type: "next_step" };
  }

  if (currentStep === "reps" && validated.includes("/")) {
    if (!repsListMatchesSets(validated, data.sets)) {
      await ctx.reply(t("wizard.reps_sets_mismatch", ctx.language, {
        sets: String(data.sets),
        reps: String(validated.split("/").length),
      }));
      return { type: "next_step" };
    }
  }

  return await advanceWizard(ctx, currentStep, validated);
}

export async function handleWizardSkip(ctx: MyContext, _params: string): Promise<void> {
  if (!ctx.state || ctx.state.action !== "exercise_log" || !ctx.from?.id) {
    await ctx.answerCallbackQuery({ text: t("wizard.wizard_expired", ctx.language), show_alert: true }).catch(() => {});
    return;
  }

  const data = (ctx.state?.data ?? {}) as unknown as WizardData;
  const steps = getStepsForPosition(data);
  const currentStep = ctx.state.step as WizardStep | null;
  if (!currentStep || !steps.includes(currentStep)) {
    await ctx.answerCallbackQuery({ text: t("wizard.wizard_expired", ctx.language), show_alert: true }).catch(() => {});
    return;
  }

  const stepInfo = getStepPrompt(currentStep, ctx.language);
  if (stepInfo.required) {
    await ctx.answerCallbackQuery({ text: t("wizard.step_required", ctx.language), show_alert: true }).catch(() => {});
    return;
  }

  await ctx.answerCallbackQuery().catch(() => {});
  const result = await advanceWizard(ctx, currentStep, null);

  if (result.type === "completed" && result.nextExerciseIndex != null && ctx.client) {
    const { showExercise } = await import("./callbacks.js");
    const workout = await getTodayWorkout(ctx.client);
    if (workout) {
      await showExercise(ctx, result.nextExerciseIndex, workout);
    }
  }
}

function storeChildLog(data: WizardData): void {
  if (data.type !== "superset" || !data.children) return;
  const child = data.children[data.child_index];
  if (!child) return;
  if (child.type === "cardio") {
    child.duration = data.duration;
    child.distance = data.distance;
    child.pace = data.pace;
    child.heart_rate = data.heart_rate;
  } else {
    child.sets = data.sets;
    child.reps = data.reps;
    child.weight = data.weight;
    child.rpe = data.rpe;
  }
  child.comment = data.comment;
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

  const nextStep = getNextStep(currentStep, data);

  if (nextStep === null) {
    storeChildLog(data);
    if (data.type === "superset" && data.child_index < data.child_count - 1) {
      data.child_index += 1;
      data.reps = undefined;
      data.weight = undefined;
      data.rpe = undefined;
      data.comment = undefined;
      data.duration = undefined;
      data.distance = undefined;
      data.pace = undefined;
      data.heart_rate = undefined;

      const childSteps = getStepsForPosition(data);

      await setState(ctx.from.id, {
        action: "exercise_log",
        step: childSteps[0],
        data: data as unknown as Record<string, unknown>,
      });

      await ctx.reply(t("wizard.child_prompt", ctx.language, { child: currentChildName(data) }));
      const prompt = getStepPrompt(childSteps[0], ctx.language);
      await ctx.reply(`${prompt.text}\n${prompt.hint}`);
      return { type: "next_step" };
    }

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

  if (await isTodayWorkoutCompleted(ctx.client)) {
    await ctx.reply(t("workout.already_completed", ctx.language));
    await clearState(ctx.from.id).catch(() => {});
    return { type: "already_completed" };
  }

  const tz = ctx.client.timezone || DEFAULT_TIMEZONE;
  const todayStr = getTodayDateStr(tz);

  const rows: Database["public"]["Tables"]["workout_logs"]["Insert"][] = [];

  if (data.type === "superset") {
    const children = data.children ?? [];
    if (children.length === 0) {
      rows.push({
        client_id: ctx.client.id,
        date: todayStr,
        week: data.week_number,
        day_order: data.day_order,
        exercise: data.exercise_name,
        sets: data.sets ? Number(data.sets) : null,
        reps: null,
        weight: null,
        rpe: null,
        rounds: null,
        distance_km: null,
        duration_sec: null,
        heart_rate: null,
        pace: null,
        comment: data.comment || null,
      });
    } else {
      for (const child of children) {
        if (child.type === "cardio") {
          rows.push({
            client_id: ctx.client.id,
            date: todayStr,
            week: data.week_number,
            day_order: data.day_order,
            exercise: child.name,
            sets: null,
            reps: null,
            weight: null,
            rpe: null,
            rounds: null,
            distance_km: child.distance ? Number(child.distance) : null,
            duration_sec: child.duration ? Number(child.duration) : null,
            heart_rate: heartRateValue(child.heart_rate),
            pace: child.pace || null,
            comment: child.comment || null,
          });
        } else {
          rows.push({
            client_id: ctx.client.id,
            date: todayStr,
            week: data.week_number,
            day_order: data.day_order,
            exercise: child.name,
            sets: child.sets ? Number(child.sets) : null,
            reps: child.reps ?? null,
            weight: child.weight ? Number(child.weight) : null,
            rpe: child.rpe ? Number(child.rpe) : null,
            rounds: null,
            distance_km: null,
            duration_sec: null,
            heart_rate: null,
            pace: null,
            comment: child.comment || null,
          });
        }
      }
    }
  } else if (data.type === "cardio") {
    rows.push({
      client_id: ctx.client.id,
      date: todayStr,
      week: data.week_number,
      day_order: data.day_order,
      exercise: data.exercise_name,
      sets: null,
      reps: null,
      weight: null,
      rpe: null,
      duration_sec: data.duration ? Number(data.duration) : null,
      distance_km: data.distance ? Number(data.distance) : null,
      pace: data.pace || null,
      heart_rate: heartRateValue(data.heart_rate),
      rounds: null,
      comment: data.comment || null,
    });
  } else if (data.type === "circuit") {
    rows.push({
      client_id: ctx.client.id,
      date: todayStr,
      week: data.week_number,
      day_order: data.day_order,
      exercise: data.exercise_name,
      sets: null,
      reps: null,
      weight: null,
      rpe: null,
      rounds: roundsValue(data.rounds),
      duration_sec: null,
      distance_km: null,
      heart_rate: null,
      pace: null,
      comment: data.comment || null,
    });
  } else {
    rows.push({
      client_id: ctx.client.id,
      date: todayStr,
      week: data.week_number,
      day_order: data.day_order,
      exercise: data.exercise_name,
      sets: data.sets ? Number(data.sets) : null,
      reps: data.reps ?? null,
      weight: data.weight ? Number(data.weight) : null,
      rpe: data.rpe ? Number(data.rpe) : null,
      rounds: null,
      distance_km: null,
      duration_sec: null,
      heart_rate: null,
      pace: null,
      comment: data.comment || null,
    });
  }

  const { error } = await supabaseAdmin.from("workout_logs").insert(rows);

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
    return { type: "completed", nextExerciseIndex: nextIndex };
  }

  await ctx.reply(t("wizard.all_done", ctx.language));
  return { type: "completed" };
}
