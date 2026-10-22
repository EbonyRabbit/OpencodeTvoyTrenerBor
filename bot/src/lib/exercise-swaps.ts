import { supabaseAdmin } from "./supabase-admin.js";
import { normalizeExerciseName } from "./exercise-library.js";
import { loadExerciseLibraryRows } from "./exercise-library-cache.js";
import { EXERCISE_GROUP_FALLBACKS, type ExerciseGroup } from "./exercise-groups.js";
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

/** Совпадение по основе: «гантели» ↔ «гантель», «тренажёры» ↔ «тренажёр». */
function sharesStem(a: string, b: string): boolean {
  if (a === b) return true;
  const len = Math.min(a.length, b.length, 5);
  if (len < 4) return false;
  return a.slice(0, len) === b.slice(0, len);
}

function equipmentMatches(equipment: string | null | undefined, tokens: string[]): boolean {
  if (!equipment || tokens.length === 0) return false;
  const equipmentTokensList = equipmentTokens(equipment);
  if (equipmentTokensList.length === 0) return false;
  return equipmentTokensList.some((eqToken) => tokens.some((token) => sharesStem(eqToken, token)));
}

/**
 * Кандидаты на замену: та же группа мышц из библиотеки, кроме оригинала.
 * Совпавшие по инвентарю (подсказка из programs.equipment) — первыми,
 * остальные ниже, ничего не скрываем.
 *
 * Оригинал ищем в два прохода: сначала точное каноническое имя (name_key,
 * затем name), и только потом алиасы - как buildExerciseLibraryMap.
 * При пустой библиотеке возвращаем error, чтобы не путать с «нет замен».
 */
export async function findSwapCandidates(
  originalName: string,
  equipmentHint: string | null | undefined,
  limit = 5,
): Promise<{ candidates: SwapCandidate[]; noMatch: boolean; error: boolean }> {
  const key = normalizeExerciseKey(originalName);
  if (!key) return { candidates: [], noMatch: true, error: false };

  const libraryRows = await loadExerciseLibraryRows();
  if (libraryRows.length === 0) {
    console.warn(`[SWAPS] library is empty or unavailable for "${originalName}"`);
    return { candidates: [], noMatch: false, error: true };
  }

  // Детерминированный порядок: при совпадении алиасов двух записей
  // выбираем запись с меньшим id, а не случайную строку из ответа БД.
  const rows = [...libraryRows].sort((a, b) => a.id.localeCompare(b.id));
  const byCanonicalName = (row: (typeof rows)[number]): boolean =>
    normalizeExerciseKey(row.name_key ?? "") === key || normalizeExerciseKey(row.name ?? "") === key;
  const orig =
    rows.find(byCanonicalName) ??
    rows.find((row) => (row.aliases ?? []).some((alias) => normalizeExerciseKey(alias) === key));
  if (!orig?.muscle_group) return { candidates: [], noMatch: true, error: false };

  const candidatesIn = (groups: string[]) =>
    rows.filter(
      (row) => row.id !== orig.id && row.muscle_group != null && groups.includes(row.muscle_group),
    );

  // Fallback-группы подключаем только если в основной группе вообще нет
  // кандидатов, иначе упражнения из смежной группы могут вытеснить свои.
  let candidates = candidatesIn([orig.muscle_group]);
  if (candidates.length === 0) {
    const fallbacks = (EXERCISE_GROUP_FALLBACKS[orig.muscle_group as ExerciseGroup] ?? []).filter(
      (group) => group !== orig.muscle_group,
    );
    if (fallbacks.length > 0) candidates = candidatesIn(fallbacks);
  }
  if (candidates.length === 0) return { candidates: [], noMatch: true, error: false };

  const tokens = equipmentTokens(equipmentHint);
  const scored = candidates.map((row) => ({
    id: row.id,
    name: row.name,
    muscle_group: row.muscle_group ?? null,
    equipment: row.equipment ?? null,
    equipmentMatch: equipmentMatches(row.equipment, tokens),
  }));
  scored.sort((a, b) => Number(b.equipmentMatch) - Number(a.equipmentMatch));
  return { candidates: scored.slice(0, limit), noMatch: false, error: false };
}
