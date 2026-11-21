import type { MyContext } from "../bot.js";
import { guardActiveClient } from "./guards.js";
import { t, type Language } from "../i18n/index.js";
import type { Client } from "../lib/clients.js";
import { DEFAULT_TIMEZONE } from "../lib/constants.js";
import { buildExerciseLibraryMap, findLibraryEntry } from "../lib/exercise-library.js";
import { loadExerciseLibraryRows } from "../lib/exercise-library-cache.js";
import { isAssistedExercise } from "../lib/training-progress.js";
import {
  formatExerciseHistoryBlock,
  getTodayDateStr,
  isPseudoName,
  toExerciseHistoryEntry,
  truncateMessage,
  type ExerciseHistoryEntry,
} from "../lib/workout-utils.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";

const MAX_EXERCISES = 5;
const MAX_ENTRIES_PER_EXERCISE = 5;

interface ProgressLogRow {
  exercise: string | null;
  date: string | null;
  sets: number | null;
  reps: string | null;
  weight: number | null;
  rounds: number | null;
  duration_sec: number | null;
  distance_km: number | null;
  pace: string | null;
}

export async function progressHandler(ctx: MyContext): Promise<void> {
  try {
    const guard = await guardActiveClient(ctx);
    if (typeof guard === "string") {
      await ctx.reply(guard);
      return;
    }

    ctx.client = guard.client;
    const lang = ctx.language || "ru";
    const text = await buildProgressText(guard.client, lang);
    const html = text.includes("<b>") || text.includes("<i>");
    await ctx.reply(text, html ? { parse_mode: "HTML" } : undefined);
  } catch (err) {
    console.error(`[PROGRESS] Error for ${ctx.from?.id}:`, err);
    await ctx.reply(t("error.service_unavailable", ctx.language)).catch(() => {});
  }
}

async function buildProgressText(client: Client, lang: Language): Promise<string> {
  const todayStr = getTodayDateStr(client.timezone || DEFAULT_TIMEZONE);
  const { data, error } = await supabaseAdmin
    .from("workout_logs")
    .select("exercise, date, sets, reps, weight, rounds, duration_sec, distance_km, pace")
    .eq("client_id", client.id)
    .lte("date", todayStr)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    throw new Error("Workout log query failed", { cause: error });
  }

  const groups = new Map<string, { name: string; entries: ExerciseHistoryEntry[] }>();
  for (const row of (data ?? []) as ProgressLogRow[]) {
    const name = row.exercise?.trim();
    if (!name || isPseudoName(name)) continue;
    const key = name.toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = { name, entries: [] };
      groups.set(key, group);
    }
    if (group.entries.length < MAX_ENTRIES_PER_EXERCISE) {
      group.entries.push(toExerciseHistoryEntry(row as unknown as Record<string, unknown>));
    }
  }

  const lines = [t("progress.title", lang), ""];
  if (groups.size === 0) {
    lines.push(t("progress.no_data", lang));
    return lines.join("\n");
  }

  let libraryMap = buildExerciseLibraryMap([]);
  try {
    libraryMap = buildExerciseLibraryMap(await loadExerciseLibraryRows());
  } catch (err) {
    console.warn(`[PROGRESS] Equipment lookup failed for ${client.id}:`, err);
  }

  const blocks = Array.from(groups.values())
    .slice(0, MAX_EXERCISES)
    .map(({ name, entries }) => {
      const equipment = findLibraryEntry(libraryMap, name)?.equipment ?? null;
      return formatExerciseHistoryBlock(
        name,
        entries,
        lang,
        isAssistedExercise(name, equipment),
      );
    });

  return truncateMessage(
    [...lines, blocks.join("\n\n")].join("\n"),
    t("progress.truncation_suffix", lang),
    { html: true },
  );
}
