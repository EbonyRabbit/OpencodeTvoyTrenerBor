import type { MyContext } from "../bot.js";
import {
  buildExerciseLibraryMap,
  findLibraryEntry,
} from "../lib/exercise-library.js";
import { t } from "../i18n/index.js";
import { truncateMessage } from "../lib/workout-utils.js";
import { loadExerciseLibraryRows, buildInfoHtml } from "./exercise-info.js";

export async function exerciseHandler(ctx: MyContext): Promise<void> {
  try {
    const query = typeof ctx.match === "string" ? ctx.match.trim() : "";
    if (!query) {
      await ctx.reply(t("exercise_lib.usage_hint", ctx.language));
      return;
    }

    const rows = await loadExerciseLibraryRows();
    const map = buildExerciseLibraryMap(rows);
    const entry = findLibraryEntry(map, query);

    if (!entry) {
      await ctx.reply(t("exercise_lib.search_none", ctx.language, { name: query }));
      return;
    }

    const html = buildInfoHtml([{ name: entry.name, entry }], ctx.language);
    const truncated = truncateMessage(html, t("program.truncation_suffix", ctx.language), { html: true });
    await ctx.reply(truncated, { parse_mode: "HTML" });
  } catch (err) {
    console.error(`[EXERCISE] Error for ${ctx.from?.id}:`, err);
    try {
      await ctx.reply(t("error.service_unavailable", ctx.language));
    } catch {
      // fallback reply failed
    }
  }
}