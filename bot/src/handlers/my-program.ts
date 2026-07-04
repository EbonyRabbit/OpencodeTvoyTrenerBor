import type { MyContext } from "../bot.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import {
  getParsedContent,
  buildSpreadsheetUrl,
  getTotalWeeks,
  getCurrentWeek,
  getWorkoutDaysCount,
} from "../lib/program-utils.js";
import { t, applyClientLanguage } from "../i18n/index.js";
import { guardActiveClient } from "./guards.js";
import { getTodayDateStr } from "../lib/workout-utils.js";
import { DEFAULT_TIMEZONE } from "../lib/constants.js";

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export async function myProgramHandler(ctx: MyContext): Promise<void> {
  const telegramId = ctx.from?.id;

  if (!telegramId) {
    await ctx.reply(t("error.user_not_identified", ctx.language));
    return;
  }

  try {
    const guard = await guardActiveClient(ctx);
    if (typeof guard === "string") {
      await ctx.reply(guard);
      return;
    }

    const { client } = guard;

    if (!client.program_id) {
      await ctx.reply(t("client.no_program", ctx.language));
      return;
    }

    const safeName = client.name ?? t("greeting.default_name", ctx.language);

    const { data: program, error: programError } = await supabaseAdmin
      .from("programs")
      .select("id, title, type, duration_weeks, parsed_content, description")
      .eq("id", client.program_id)
      .maybeSingle();

    if (programError) {
      console.error(`[MYPROGRAM] Program query error for ${telegramId}:`, programError.message);
      await ctx.reply(t("error.service_unavailable", ctx.language));
      return;
    }

    if (!program) {
      await ctx.reply(
        [
          t("greeting.hello", ctx.language, { name: safeName }),
          "",
          t("client.program_not_found", ctx.language),
        ].join("\n"),
      );
      return;
    }

    const { data: schedule, error: scheduleError } = await supabaseAdmin
      .from("program_schedule")
      .select("week_number, start_date, end_date, is_deload, focus")
      .eq("client_id", client.id)
      .order("week_number");

    if (scheduleError) {
      console.error(`[MYPROGRAM] Schedule query error for ${telegramId}:`, scheduleError.message);
    }

    const parsed = getParsedContent(program.parsed_content);
    const totalWeeks = getTotalWeeks(parsed);
    const tz = client.timezone || DEFAULT_TIMEZONE;
    const todayStr = getTodayDateStr(tz);
    const currentWeek = getCurrentWeek(schedule ?? [], todayStr);
    const truncationSuffix = t("program.truncation_suffix", ctx.language);

    const lines: string[] = [
      t("greeting.hello", ctx.language, { name: safeName }),
      "",
      t("program.title_label", ctx.language, { title: program.title }),
    ];

    if (program.type) {
      lines.push(t("program.type_label", ctx.language, { type: program.type }));
    }

    if (program.duration_weeks) {
      lines.push(t("program.duration_label", ctx.language, { weeks: program.duration_weeks }));
    }

    if (totalWeeks > 0 && currentWeek !== null) {
      const currentWeekData = parsed?.weeks?.find((w) => w.week_number === currentWeek);
      const label = currentWeekData?.week_label || t("program.week_fallback", ctx.language, { week: currentWeek });
      if (currentWeekData?.is_deload) {
        lines.push(t("program.current_week_deload", ctx.language, { label, current: currentWeek, total: totalWeeks }));
      } else {
        lines.push(t("program.current_week", ctx.language, { label, current: currentWeek, total: totalWeeks }));
      }

      const workoutDays = getWorkoutDaysCount(parsed, currentWeek);
      if (workoutDays > 0) {
        lines.push(t("program.workout_days", ctx.language, { count: workoutDays }));
      }

      if (currentWeekData?.days && currentWeekData.days.length > 0) {
        lines.push("");
        lines.push(t("program.days_header", ctx.language));
        for (const day of currentWeekData.days) {
          const exCount = day.exercises?.length ?? 0;
          const icon = exCount > 0 ? "✅" : "⬜";
          lines.push(`  ${icon} ${day.day_name}`);
        }
      }
    } else if (totalWeeks > 0) {
      lines.push(t("program.total_weeks", ctx.language, { count: totalWeeks }));
    }

    const spreadsheetUrl = buildSpreadsheetUrl(client.spreadsheet_id);
    if (spreadsheetUrl) {
      lines.push("");
      lines.push(t("program.spreadsheet", ctx.language, { url: spreadsheetUrl }));
    }

    if (program.description) {
      lines.push("");
      lines.push(t("program.description", ctx.language, { text: program.description }));
    }

    const message = lines.join("\n");
    if (message.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
      const limit = TELEGRAM_MAX_MESSAGE_LENGTH - truncationSuffix.length - 1;
      const truncated = message.slice(0, limit);
      const lastNewline = truncated.lastIndexOf("\n");
      const safeTruncated = lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated;
      await ctx.reply(safeTruncated + truncationSuffix);
    } else {
      await ctx.reply(message);
    }
  } catch (err) {
    console.error(`[MYPROGRAM] Error for ${telegramId}:`, err);
    try {
      await ctx.reply(t("error.service_unavailable", ctx.language));
    } catch {
      // fallback reply failed
    }
  }
}
