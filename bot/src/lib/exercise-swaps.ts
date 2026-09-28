import { supabaseAdmin } from "./supabase-admin.js";
import { normalizeExerciseName } from "./exercise-library.js";
import type { ParsedExercise } from "./program-utils.js";

export interface SwapRow {
  exercise_key: string;
  replacement_name: string;
}

export interface SwapCandidate {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  equipmentMatch: boolean;
}

/** Ключ замены: те же правила, что name_key в библиотеке (lowercase, trim, ё→е, без пунктуации). */
export function normalizeExerciseKey(name: string): string {
  return normalizeExerciseName(name);
}

export async function getClientSwaps(clientId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data, error } = await supabaseAdmin
    .from("client_exercise_swaps")
    .select("exercise_key, replacement_name")
    .eq("client_id", clientId);
  if (error) {
    console.warn(`[SWAPS] getClientSwaps(${clientId}) error:`, error.message);
    return map;
  }
  for (const row of (data ?? []) as SwapRow[]) {
    map.set(row.exercise_key, row.replacement_name);
  }
  return map;
}

export async function saveSwap(clientId: string, originalName: string, replacementName: string): Promise<void> {
  const key = normalizeExerciseKey(originalName);
  if (!key) throw new Error("saveSwap: empty exercise key");
  const cleanOriginal = originalName.trim();
  const cleanReplacement = replacementName.trim();
  if (!cleanOriginal) throw new Error("saveSwap: empty original name");
  if (!cleanReplacement) throw new Error("saveSwap: empty replacement name");
  const { error } = await supabaseAdmin.from("client_exercise_swaps").upsert(
    { client_id: clientId, exercise_key: key, original_name: cleanOriginal, replacement_name: cleanReplacement },
    { onConflict: "client_id,exercise_key" },
  );
  if (error) throw new Error(`saveSwap failed: ${error.message}`);
}

export async function revertSwap(clientId: string, originalName: string): Promise<void> {
  const key = normalizeExerciseKey(originalName);
  if (!key) return;
  const { error } = await supabaseAdmin
    .from("client_exercise_swaps")
    .delete()
    .eq("client_id", clientId)
    .eq("exercise_key", key);
  if (error) throw new Error(`revertSwap failed: ${error.message}`);
}

/**
 * Накладывает персональные замены поверх упражнений дня.
 * Меняет только имя (и детей суперсетов/кругов рекурсивно),
 * подходы/повторы/вес остаются от оригинала. Канон не мутирует.
 */
export function applySwapsToExercises(
  exercises: ParsedExercise[],
  swaps: Map<string, string>,
): ParsedExercise[] {
  if (swaps.size === 0) return exercises;
  return exercises.map((ex) => applySwapToExercise(ex, swaps));
}

function applySwapToExercise(ex: ParsedExercise, swaps: Map<string, string>): ParsedExercise {
  const replacement = swaps.get(normalizeExerciseKey(ex.name));
  const children = ex.children?.map((c) => applySwapToExercise(c, swaps));
  if (!replacement && !children) return ex;
  return {
    ...ex,
    ...(replacement ? { name: replacement, swapped_from: ex.swapped_from ?? ex.name } : {}),
    ...(children ? { children } : {}),
  };
}

function equipmentTokens(hint: string | null | undefined): string[] {
  if (!hint) return [];
  return hint
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^a-zа-я0-9]+/gu)
    .filter((t) => t.length > 2);
}

/**
 * Кандидаты на замену: та же группа мышц из библиотеки, кроме оригинала.
 * Совпавшие по инвентарю (подсказка из programs.equipment) — первыми,
 * остальные ниже, ничего не скрываем. Пусто + noMatch, если оригинал
 * в библиотеке не найден.
 */
export async function findSwapCandidates(
  originalName: string,
  equipmentHint: string | null | undefined,
  limit = 5,
): Promise<{ candidates: SwapCandidate[]; noMatch: boolean }> {
  const key = normalizeExerciseKey(originalName);
  if (!key) return { candidates: [], noMatch: true };
  const { data: origRows, error: origErr } = await supabaseAdmin
    .from("exercises")
    .select("id, name, name_key, aliases, muscle_group")
    .or(`name_key.eq.${key},aliases.cs.{${key}}`)
    .limit(1);
  if (origErr) {
    console.warn(`[SWAPS] findSwapCandidates lookup error:`, origErr.message);
    return { candidates: [], noMatch: true };
  }
  const orig = (origRows ?? [])[0] as { id: string; muscle_group: string | null } | undefined;
  if (!orig?.muscle_group) return { candidates: [], noMatch: true };

  const { data, error } = await supabaseAdmin
    .from("exercises")
    .select("id, name, muscle_group, equipment")
    .eq("muscle_group", orig.muscle_group)
    .neq("id", orig.id)
    .limit(limit * 3);
  if (error) {
    console.warn(`[SWAPS] findSwapCandidates list error:`, error.message);
    return { candidates: [], noMatch: true };
  }

  const tokens = equipmentTokens(equipmentHint);
  const scored = ((data ?? []) as Omit<SwapCandidate, "equipmentMatch">[]).map((r) => {
    const eq = (r.equipment ?? "").toLowerCase();
    return { ...r, equipmentMatch: tokens.length > 0 && tokens.some((t) => eq.includes(t)) };
  });
  scored.sort((a, b) => Number(b.equipmentMatch) - Number(a.equipmentMatch));
  return { candidates: scored.slice(0, limit), noMatch: false };
}
