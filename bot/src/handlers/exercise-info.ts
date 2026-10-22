import type { MyContext } from "../bot.js";
import {
  buildExerciseLibraryMap,
  formatExerciseInfo,
  normalizeExerciseName,
  type ExerciseLibraryEntry,
} from "../lib/exercise-library.js";
import {
  LIBRARY_SELECT,
  clearExerciseLibraryCache,
  loadExerciseLibraryRows,
} from "../lib/exercise-library-cache.js";
import { t, type Language } from "../i18n/index.js";
import { escapeHtml, truncateMessage } from "../lib/workout-utils.js";
import type { ParsedExercise } from "../lib/program-utils.js";

// Кнопка «Техника и видео» живёт в детальном виде упражнения
// (buildExerciseKeyboard в callbacks.ts), т.к. общее сообщение /today
// имеет одну клавиатуру на всё сообщение.
//
// callback_data (лимит Telegram 64 байта):
//   exercise_info:e:<hash>               - одно упражнение
//   exercise_info:s:<hash>[,<hash>...]   - композит (суперсет/круг):
//     хэши детей, присутствующих в библиотеке (до 5, сообщение собирается
//     из техники каждого найденного ребёнка)
// hash = первые 8 hex SHA-1 от normalize(name) конкретного упражнения.

export { LIBRARY_SELECT, clearExerciseLibraryCache, loadExerciseLibraryRows };

async function sha1Hex(text: string): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashLibraryKey(key: string): Promise<string> {
  return (await sha1Hex(key)).slice(0, 8);
}

const MAX_CALLBACK_CHILDREN = 5;

export async function buildExerciseInfoButton(
  ex: ParsedExercise,
  map: Map<string, ExerciseLibraryEntry>,
  lang: Language,
): Promise<{ text: string; callback_data: string } | null> {
  const isComposite = ex.type === "superset" || ex.type === "circuit";

  if (isComposite) {
    const matched: string[] = [];
    for (const child of ex.children ?? []) {
      const key = normalizeExerciseName(child.name);
      if (key && map.has(key) && !matched.includes(key)) matched.push(key);
    }
    if (matched.length === 0) return null;
    const hashes = await Promise.all(
      matched.slice(0, MAX_CALLBACK_CHILDREN).map(hashLibraryKey),
    );
    return {
      text: t("workout.exercise_info_button", lang),
      callback_data: `exercise_info:s:${hashes.join(",")}`,
    };
  }

  const key = normalizeExerciseName(ex.name);
  if (!key || !map.has(key)) return null;
  return {
    text: t("workout.exercise_info_button", lang),
    callback_data: `exercise_info:e:${await hashLibraryKey(key)}`,
  };
}

function entryInfoHtml(name: string, entry: ExerciseLibraryEntry, lang: Language): string {
  const { text, videoUrl } = formatExerciseInfo(entry, lang);
  const lines = [`<b>${escapeHtml(name)}</b>`, "", escapeHtml(text)];
  if (videoUrl) {
    lines.push("", `${t("exercise_lib.video_prefix", lang)} <a href="${escapeHtml(videoUrl)}">${escapeHtml(t("exercise_lib.video_label", lang))}</a>`);
  }
  return lines.join("\n");
}

export function buildInfoHtml(
  parts: { name: string; entry: ExerciseLibraryEntry | null }[],
  lang: Language,
): string {
  const lines: string[] = [];
  parts.forEach((part, i) => {
    if (i > 0) lines.push("");
    if (!part.entry) {
      lines.push(`<i>${escapeHtml(part.name)} - ${escapeHtml(t("exercise_lib.not_found", lang))}</i>`);
      return;
    }
    const numbered = parts.length > 1 ? `${i + 1}. ` : "";
    lines.push(entryInfoHtml(`${numbered}${part.name}`, part.entry, lang));
  });
  return lines.join("\n");
}

export async function handleExerciseInfoCallback(ctx: MyContext, params: string): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  const colonIndex = params.indexOf(":");
  const kind = colonIndex === -1 ? params : params.slice(0, colonIndex);
  const payload = colonIndex === -1 ? "" : params.slice(colonIndex + 1);
  if (kind !== "e" && kind !== "s") {
    await ctx.reply(t("exercise_lib.not_found", ctx.language)).catch(() => {});
    return;
  }

  const hashes = kind === "e" ? [payload] : payload.split(",").filter(Boolean);
  if (hashes.length === 0) {
    await ctx.reply(t("exercise_lib.not_found", ctx.language)).catch(() => {});
    return;
  }

  const rows = await loadExerciseLibraryRows();
  if (rows.length === 0) {
    await ctx.reply(t("exercise_lib.not_found", ctx.language)).catch(() => {});
    return;
  }
  const map = buildExerciseLibraryMap(rows);

  const hashToEntry = new Map<string, ExerciseLibraryEntry>();
  for (const key of map.keys()) {
    const hash = await hashLibraryKey(key);
    if (hashToEntry.has(hash) && hashToEntry.get(hash) !== map.get(key)) {
      console.warn(`[EXERCISE_INFO] SHA-1 prefix collision for "${key}"`);
    }
    hashToEntry.set(hash, map.get(key)!);
  }

  const seen = new Set<string>();
  const found = hashes
    .map((hash) => hashToEntry.get(hash))
    .filter((entry): entry is ExerciseLibraryEntry => Boolean(entry))
    .filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });

  if (found.length === 0) {
    await ctx.reply(t("exercise_lib.not_found", ctx.language)).catch(() => {});
    return;
  }

  const parts = found.map((entry) => ({ name: entry.name, entry }));
  const html = buildInfoHtml(parts, ctx.language);
  const truncated = truncateMessage(html, t("program.truncation_suffix", ctx.language), { html: true });
  await ctx.reply(truncated, { parse_mode: "HTML" }).catch(() => {});
}