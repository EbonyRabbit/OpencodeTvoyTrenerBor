import type { MyContext } from "../bot.js";
import { getTodayWorkout } from "../lib/workout-utils.js";
import {
  getClientSwaps,
  saveSwap,
  revertSwap,
  findSwapCandidates,
  normalizeExerciseKey,
  type SwapCandidate,
} from "../lib/exercise-swaps.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { t, type Language } from "../i18n/index.js";
import { showExercise } from "./callbacks.js";
import type { ParsedExercise } from "../lib/program-utils.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANDIDATE_LIMIT = 5;

function originalNameOf(ex: ParsedExercise): string {
  return ex.swapped_from ?? ex.name;
}

async function programEquipmentHint(programId: string | null): Promise<string | null> {
  if (!programId) return null;
  const { data, error } = await supabaseAdmin
    .from("programs")
    .select("equipment")
    .eq("id", programId)
    .maybeSingle();
  if (error || !data) return null;
  const eq = (data as { equipment: string | null }).equipment;
  return eq?.trim() ? eq : null;
}

function candidateRows(
  index: number,
  childIdx: number,
  candidates: SwapCandidate[],
  lang: Language,
): { text: string; callback_data: string }[][] {
  return candidates.map((c) => [
    {
      text: `${c.name}${c.equipment ? ` (${c.equipment})` : ""}`.slice(0, 60),
      callback_data: `swap_pick:${index}:${childIdx}:${c.id}`,
    },
  ]);
}

async function showCandidates(
  ctx: MyContext,
  index: number,
  childIdx: number,
  target: ParsedExercise,
  lang: Language,
): Promise<void> {
  if (!ctx.client) return;
  const hint = await programEquipmentHint(ctx.client.program_id);
  const original = originalNameOf(target);
  const { candidates, noMatch } = await findSwapCandidates(original, hint, CANDIDATE_LIMIT);

  if (noMatch || candidates.length === 0) {
    await ctx.reply(t("swap.no_match", lang, { name: original } as Record<string, string>));
    await showExercise(ctx, index);
    return;
  }

  const swaps = await getClientSwaps(ctx.client.id);
  const current = swaps.get(normalizeExerciseKey(original));

  const lines = [
    t("swap.list_title", lang, { name: original } as Record<string, string>),
    ...(current ? [t("swap.current_is", lang, { name: current } as Record<string, string>)] : []),
  ];
  const rows = candidateRows(index, childIdx, candidates, lang);
  if (current) {
    rows.push([{ text: t("swap.btn_revert", lang), callback_data: `swap_revert:${index}:${childIdx}` }]);
  }
  rows.push([{ text: t("swap.btn_back", lang), callback_data: `swap_back:${index}` }]);

  await ctx.reply(lines.join("\n"), { reply_markup: { inline_keyboard: rows } });
}

export async function handleSwapOpen(ctx: MyContext, params: string): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  if (!ctx.client) return;
  const index = Number(params);
  if (!Number.isInteger(index) || index < 0) return;

  const workout = await getTodayWorkout(ctx.client);
  const target = workout?.exercises[index];
  if (!target) {
    await showExercise(ctx, index);
    return;
  }

  if (target.children?.length) {
    const rows = target.children.map((c, ci) => [
      { text: c.name.slice(0, 60), callback_data: `exercise_swap_child:${index}:${ci}` },
    ]);
    rows.push([{ text: t("swap.btn_back", ctx.language), callback_data: `swap_back:${index}` }]);
    await ctx.reply(t("swap.pick_child_title", ctx.language), { reply_markup: { inline_keyboard: rows } });
    return;
  }

  await showCandidates(ctx, index, -1, target, ctx.language);
}

export async function handleSwapChild(ctx: MyContext, params: string): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  if (!ctx.client) return;
  const [indexRaw, childRaw] = params.split(":");
  const index = Number(indexRaw);
  const childIdx = Number(childRaw);
  if (!Number.isInteger(index) || index < 0 || !Number.isInteger(childIdx) || childIdx < 0) return;

  const workout = await getTodayWorkout(ctx.client);
  const child = workout?.exercises[index]?.children?.[childIdx];
  if (!child) {
    await showExercise(ctx, index);
    return;
  }
  await showCandidates(ctx, index, childIdx, child, ctx.language);
}

export async function handleSwapPick(ctx: MyContext, params: string): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  if (!ctx.client) return;
  const [indexRaw, childRaw, exerciseId] = params.split(":");
  const index = Number(indexRaw);
  const childIdx = Number(childRaw);
  if (!Number.isInteger(index) || index < 0 || !Number.isInteger(childIdx) || !exerciseId || !UUID_REGEX.test(exerciseId)) return;

  const workout = await getTodayWorkout(ctx.client);
  const target =
    childIdx >= 0 ? workout?.exercises[index]?.children?.[childIdx] : workout?.exercises[index];
  if (!target) {
    await showExercise(ctx, index);
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("exercises")
    .select("name")
    .eq("id", exerciseId)
    .maybeSingle();
  const replacement = (data as { name?: string } | null)?.name?.trim();
  if (error || !replacement) {
    await showExercise(ctx, index);
    return;
  }

  try {
    await saveSwap(ctx.client.id, originalNameOf(target), replacement);
  } catch (err) {
    console.warn(`[SWAP] saveSwap failed for ${ctx.client.id}:`, err);
    await ctx.reply(t("error.service_unavailable", ctx.language));
    return;
  }
  await ctx.reply(t("swap.saved", ctx.language, { name: replacement } as Record<string, string>));
  await showExercise(ctx, index, await getTodayWorkout(ctx.client));
}

export async function handleSwapRevert(ctx: MyContext, params: string): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  if (!ctx.client) return;
  const [indexRaw, childRaw] = params.split(":");
  const index = Number(indexRaw);
  const childIdx = Number(childRaw);
  if (!Number.isInteger(index) || index < 0) return;

  const workout = await getTodayWorkout(ctx.client);
  const target =
    Number.isInteger(childIdx) && childIdx >= 0
      ? workout?.exercises[index]?.children?.[childIdx]
      : workout?.exercises[index];
  if (!target) {
    await showExercise(ctx, index);
    return;
  }

  try {
    await revertSwap(ctx.client.id, originalNameOf(target));
  } catch (err) {
    console.warn(`[SWAP] revertSwap failed for ${ctx.client.id}:`, err);
    await ctx.reply(t("error.service_unavailable", ctx.language));
    return;
  }
  await ctx.reply(t("swap.reverted", ctx.language));
  await showExercise(ctx, index, await getTodayWorkout(ctx.client));
}

export async function handleSwapBack(ctx: MyContext, params: string): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  const index = Number(params);
  if (!Number.isInteger(index) || index < 0) return;
  await showExercise(ctx, index);
}
