/**
 * One-off backfill: pin existing workout_logs rows to their planned day.
 *
 * For every row with day_order IS NULL:
 *   - day_order = index of the row's weekday in client.training_days + 1
 *     (only when the date is a training day and the planned day for that
 *     week has exercises; otherwise stays NULL)
 *   - [SKIP] rows also get `week` from the program_schedule matching date.
 *
 * Idempotent: only touches rows where the value is still NULL.
 *
 * Run from bot/: npx tsx scripts/backfill-workout-day-order.ts
 */
import "dotenv/config";
import { supabaseAdmin } from "../src/lib/supabase-admin.js";
import { getIsoWeekday, getTodayDateStr } from "../src/lib/workout-utils.js";
import { getParsedContent } from "../src/lib/program-utils.js";

interface LogRow {
  id: string;
  date: string;
  week: number | null;
  exercise: string;
}

interface ScheduleRow {
  week_number: number;
  start_date: string | null;
  end_date: string | null;
}

async function main(): Promise<void> {
  const { data: clients } = await supabaseAdmin
    .from("clients")
    .select("id, program_id, training_days, timezone")
    .order("id");
  if (!clients) {
    console.error("Failed to load clients");
    process.exit(1);
  }

  console.log(`Clients to process: ${clients.length}`);
  let updatedRows = 0;
  let skippedRows = 0;

  for (const client of clients) {
    if (!client.program_id) continue;

    const todayStr = getTodayDateStr(client.timezone || "Europe/Moscow");

    const [scheduleResult, programResult, logsResult] = await Promise.all([
      supabaseAdmin
        .from("program_schedule")
        .select("week_number, start_date, end_date")
        .eq("client_id", client.id),
      supabaseAdmin
        .from("programs")
        .select("parsed_content")
        .eq("id", client.program_id)
        .maybeSingle(),
      supabaseAdmin
        .from("workout_logs")
        .select("id, date, week, exercise")
        .eq("client_id", client.id)
        .is("day_order", null)
        .lte("date", todayStr),
    ]);

    const schedule = (scheduleResult.data ?? []) as ScheduleRow[];
    const logs = (logsResult.data ?? []) as LogRow[];
    if (logs.length === 0) continue;

    const parsed = getParsedContent(programResult.data?.parsed_content ?? null);
    const weekDays = new Map<number, Set<number>>();
    for (const week of parsed?.weeks ?? []) {
      const orders = new Set(
        (week.days ?? [])
          .filter((d) => (d.exercises?.length ?? 0) > 0)
          .map((d) => d.day_order),
      );
      if (orders.size > 0) weekDays.set(week.week_number, orders);
    }

    const patches: Array<{ id: string; patch: { day_order: number; week?: number } }> = [];
    for (const log of logs) {
      const iso = getIsoWeekday(log.date);
      if (iso === 0) {
        skippedRows++;
        continue;
      }

      const index = (client.training_days ?? []).indexOf(iso);
      if (index === -1) {
        skippedRows++;
        continue;
      }
      const dayOrder = index + 1;

      const week = schedule.find(
        (w) => w.start_date && w.end_date && log.date >= w.start_date && log.date <= w.end_date,
      );

      if (!week) {
        skippedRows++;
        continue;
      }

      const plannedOrders = weekDays.get(week.week_number);
      if (!plannedOrders || !plannedOrders.has(dayOrder)) {
        skippedRows++;
        continue;
      }

      const isSkip = log.exercise?.trim().toLowerCase().startsWith("[skip]");
      const patch: { day_order: number; week?: number } = { day_order: dayOrder };
      if (isSkip && log.week == null) patch.week = week.week_number;
      patches.push({ id: log.id, patch });
    }

    const BATCH_SIZE = 100;
    for (let i = 0; i < patches.length; i += BATCH_SIZE) {
      const batch = patches.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(({ id, patch }) =>
          supabaseAdmin.from("workout_logs").update(patch).eq("id", id),
        ),
      );
      for (const { error } of results) {
        if (error) {
          console.error(`  update failed: ${error.message}`);
          continue;
        }
        updatedRows++;
      }
    }
  }

  console.log(`Done. Updated: ${updatedRows}, skipped: ${skippedRows}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
