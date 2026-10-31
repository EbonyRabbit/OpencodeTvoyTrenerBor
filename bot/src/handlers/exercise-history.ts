import type { MyContext } from "../bot.js";
import {
  formatExerciseHistoryBlock,
  getExerciseHistory,
  getTodayWorkout,
  truncateMessage,
  type TodayWorkout,
} from "../lib/workout-utils.js";
import { isWarmCool, type ParsedExercise } from "../lib/program-utils.js";
import { isAssistedExercise } from "../lib/training-progress.js";
import { loadExerciseLibraryRows } from "./exercise-info.js";
import { buildExerciseLibraryMap, findLibraryEntry } from "../lib/exercise-library.js";
import { t } from "../i18n/index.js";

function historyItems(exercise: ParsedExercise): ParsedExercise[] {
  if (exercise.type === "superset" && exercise.children?.length) {
    const children = exercise.children.filter((child) => !isWarmCool(child));
    return children.length > 0 ? children : [exercise];
  }
  return [exercise];
}

export async function handleExerciseHistory(
  ctx: MyContext,
  params: string,
): Promise<void> {
  const index = Number(params);
  if (!params || !Number.isInteger(index) || index < 0) {
    await ctx.answerCallbackQuery({
      text: t("error.invalid_exercise_index", ctx.language),
      show_alert: true,
    }).catch(() => {});
    return;
  }

  if (!ctx.client) {
    await ctx.answerCallbackQuery({
      text: t("error.user_not_identified", ctx.language),
      show_alert: true,
    }).catch(() => {});
    return;
  }

  let workout: TodayWorkout | null;
  try {
    workout = await getTodayWorkout(ctx.client);
  } catch (err) {
    console.error(`[HISTORY] Workout query failed for ${ctx.client.id}:`, err);
    await ctx.answerCallbackQuery({
      text: t("error.service_unavailable", ctx.language),
      show_alert: true,
    }).catch(() => {});
    return;
  }

  const exercise = workout?.exercises[index];
  if (!workout || !exercise || isWarmCool(exercise)) {
    await ctx.answerCallbackQuery({
      text: t("error.invalid_exercise_index", ctx.language),
      show_alert: true,
    }).catch(() => {});
    return;
  }

  await ctx.answerCallbackQuery().catch(() => {});

  let libraryMap = buildExerciseLibraryMap([]);
  try {
    libraryMap = buildExerciseLibraryMap(await loadExerciseLibraryRows() ?? []);
  } catch (err) {
    console.warn(`[HISTORY] Equipment lookup failed for ${ctx.client.id}:`, err);
  }

  const blocks: string[] = [];
  try {
    for (const item of historyItems(exercise)) {
      const entries = await getExerciseHistory(ctx.client, item.name, 5);
      const equipment = findLibraryEntry(libraryMap, item.name)?.equipment ?? null;
      blocks.push(formatExerciseHistoryBlock(
        item.name,
        entries,
        ctx.language,
        isAssistedExercise(item.name, equipment),
      ));
    }
  } catch (err) {
    console.error(`[HISTORY] Log query failed for ${ctx.client.id}:`, err);
    await ctx.reply(t("error.service_unavailable", ctx.language));
    return;
  }

  const text = truncateMessage(
    blocks.join("\n\n"),
    t("program.truncation_suffix", ctx.language),
    { html: true },
  );
  await ctx.reply(text, { parse_mode: "HTML" });
}
