import type { MyContext } from "../bot.js";
import { t, type Language } from "../i18n/index.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { getTodayDateStr } from "../lib/workout-utils.js";
import { DEFAULT_TIMEZONE } from "../lib/constants.js";

interface WorkoutRow {
  date: string;
  exercise: string;
  rpe: number | null;
}

export async function myStatsHandler(ctx: MyContext): Promise<void> {
  const client = ctx.client;
  if (!client) {
    await ctx.reply(t("error.user_not_identified", ctx.language));
    return;
  }

  const lang = (client.language || "ru") as Language;
  const tz = client.timezone || DEFAULT_TIMEZONE;
  const todayStr = getTodayDateStr(tz);
  const monthStart = todayStr.slice(0, 7) + "-01";
  const monthLabel = todayStr.slice(0, 7);

  try {
    const { data, error } = await supabaseAdmin
      .from("workout_logs")
      .select("date, exercise, rpe")
      .eq("client_id", client.id)
      .gte("date", monthStart)
      .lte("date", todayStr)
      .order("date", { ascending: true });

    if (error) {
      console.error(`[MYSTATS] Failed to fetch stats for ${client.id}:`, error);
      await ctx.reply(t("error.service_unavailable", lang));
      return;
    }

    const rows = (data ?? []) as WorkoutRow[];

    if (rows.length === 0) {
      await ctx.reply(t("mystats.no_data", lang));
      return;
    }

    const dateGroups = new Map<string, WorkoutRow[]>();
    for (const row of rows) {
      const existing = dateGroups.get(row.date);
      if (existing) {
        existing.push(row);
      } else {
        dateGroups.set(row.date, [row]);
      }
    }

    let completedCount = 0;
    let skippedCount = 0;
    const rpeValues: number[] = [];

    for (const [, dayRows] of dateGroups) {
      const hasSkip = dayRows.some((r) => r.exercise === "[SKIP]");
      const hasReal = dayRows.some((r) => r.exercise !== "[SKIP]");

      if (hasSkip && !hasReal) {
        skippedCount++;
      } else if (hasReal) {
        completedCount++;
        for (const r of dayRows) {
          if (r.exercise !== "[SKIP]" && r.rpe != null) {
            rpeValues.push(r.rpe);
          }
        }
      }
    }

    const avgRpe = rpeValues.length > 0
      ? (rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length).toFixed(1)
      : null;

    const lines: string[] = [
      t("mystats.title", lang),
      t("mystats.month_label", lang, { month: monthLabel }),
      "",
      t("mystats.completed", lang, { count: String(completedCount) }),
      t("mystats.skipped", lang, { count: String(skippedCount) }),
      t("mystats.total_days", lang, { count: String(completedCount + skippedCount) }),
      avgRpe
        ? t("mystats.avg_rpe", lang, { rpe: avgRpe })
        : t("mystats.avg_rpe_none", lang),
    ];

    await ctx.reply(lines.join("\n"));
  } catch (err) {
    console.error(`[MYSTATS] Error for ${client.id}:`, err);
    await ctx.reply(t("error.service_unavailable", lang));
  }
}
