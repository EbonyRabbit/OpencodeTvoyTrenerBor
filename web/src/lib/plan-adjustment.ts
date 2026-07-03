import { supabaseAdmin } from "./supabase-admin";
import { getParsedContent } from "./program-utils";
import type { Database } from "@/types/supabase";
import type { PauseReason, ResumeStrategy } from "@/types/supabase";

export type { PauseReason, ResumeStrategy };

export type PlanPause = Database["public"]["Tables"]["plan_pauses"]["Row"];

export type ScheduleWeek = Pick<
  Database["public"]["Tables"]["program_schedule"]["Row"],
  "id" | "client_id" | "week_number" | "start_date" | "end_date" | "original_start_date" | "original_end_date" | "focus" | "status"
>;

export type EffectiveWeek = ScheduleWeek & {
  is_paused: boolean;
};

function daysBetween(a: string, b: string): number {
  const d1 = new Date(a + "T12:00:00Z");
  const d2 = new Date(b + "T12:00:00Z");
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

export function suggestStrategy(pauseDurationDays: number): ResumeStrategy {
  if (pauseDurationDays <= 2) return "skip";
  if (pauseDurationDays <= 4) return "shift";
  if (pauseDurationDays <= 7) return "deload";
  return "rollback";
}

export async function getActivePause(clientId: string): Promise<PlanPause | null> {
  const { data } = await supabaseAdmin
    .from("plan_pauses")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "active")
    .maybeSingle();
  return data;
}

export async function getPauseHistory(clientId: string): Promise<PlanPause[]> {
  const { data } = await supabaseAdmin
    .from("plan_pauses")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function createPause(
  clientId: string,
  pauseStart: string,
  reason: PauseReason,
  plannedResumeDate?: string | null,
): Promise<{ error?: string }> {
  const existing = await getActivePause(clientId);
  if (existing) {
    return { error: "У клиента уже есть активная пауза. Завершите её перед созданием новой." };
  }

  const { error } = await supabaseAdmin
    .from("plan_pauses")
    .insert({
      client_id: clientId,
      pause_start: pauseStart,
      reason,
      status: "active",
      planned_resume_date: plannedResumeDate ?? null,
    });

  if (error) return { error: error.message };
  return {};
}

async function claimPause(pauseId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("plan_pauses")
    .update({ status: "resuming" })
    .eq("id", pauseId)
    .eq("status", "active")
    .select("id")
    .maybeSingle();

  if (error) return false;
  return data !== null;
}

async function completePause(
  pauseId: string,
  resumeDate: string,
  strategy: ResumeStrategy,
): Promise<{ error?: string }> {
  const { error } = await supabaseAdmin
    .from("plan_pauses")
    .update({
      pause_end: resumeDate,
      strategy,
      status: "completed",
    })
    .eq("id", pauseId);

  if (error) return { error: error.message };
  return {};
}

async function revertToActive(pauseId: string): Promise<void> {
  await supabaseAdmin
    .from("plan_pauses")
    .update({ status: "active" })
    .eq("id", pauseId)
    .eq("status", "resuming");
}

export async function resumePlan(
  clientId: string,
  resumeDate: string,
  strategy: ResumeStrategy,
): Promise<{ error?: string }> {
  const pause = await getActivePause(clientId);
  if (!pause) {
    return { error: "Нет активной паузы" };
  }

  if (!(await claimPause(pause.id))) {
    return { error: "Пауза уже обрабатывается" };
  }

  let result: { error?: string };

  try {
    if (strategy === "shift") {
      result = await applyShift(clientId, pause, resumeDate);
    } else if (strategy === "skip") {
      result = await applySkip(clientId, pause, resumeDate);
    } else if (strategy === "deload") {
      result = await applyDeload(clientId, pause, resumeDate);
    } else if (strategy === "rollback") {
      result = await applyRollback(clientId, pause, resumeDate);
    } else {
      result = { error: "Неизвестная стратегия" };
    }
  } catch (err) {
    await revertToActive(pause.id);
    return { error: err instanceof Error ? err.message : String(err) };
  }

  if (result.error) {
    await revertToActive(pause.id);
    return result;
  }

  try {
    const completeResult = await completePause(pause.id, resumeDate, strategy);
    if (completeResult.error) {
      await revertToActive(pause.id);
      return completeResult;
    }
    return {};
  } catch (err) {
    await revertToActive(pause.id);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function ensureOriginalDates(clientId: string): Promise<void> {
  const { data: schedule } = await supabaseAdmin
    .from("program_schedule")
    .select("id, start_date, end_date, original_start_date, original_end_date")
    .eq("client_id", clientId)
    .is("original_start_date", null);

  if (!schedule || schedule.length === 0) return;

  await Promise.allSettled(
    schedule.map((week) =>
      supabaseAdmin
        .from("program_schedule")
        .update({
          original_start_date: week.start_date,
          original_end_date: week.end_date,
        })
        .eq("id", week.id),
    ),
  );
}

async function applyShift(
  clientId: string,
  pause: PlanPause,
  resumeDate: string,
): Promise<{ error?: string }> {
  await ensureOriginalDates(clientId);

  const duration = daysBetween(pause.pause_start, resumeDate);

  const { data: weeks, error: fetchErr } = await supabaseAdmin
    .from("program_schedule")
    .select("id, start_date, end_date")
    .eq("client_id", clientId)
    .gte("start_date", pause.pause_start);

  if (fetchErr) return { error: fetchErr.message };
  if (!weeks) return { error: "Не удалось загрузить расписание" };

  const results = await Promise.allSettled(
    weeks
      .filter((w) => w.start_date && w.end_date)
      .map((week) =>
        supabaseAdmin
          .from("program_schedule")
          .update({
            start_date: addDays(week.start_date!, duration),
            end_date: addDays(week.end_date!, duration),
          })
          .eq("id", week.id),
      ),
  );

  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length > 0) {
    return { error: `Failed to update ${failures.length} schedule entries` };
  }

  return {};
}

async function applySkip(
  _clientId: string,
  _pause: PlanPause,
  _resumeDate: string,
): Promise<{ error?: string }> {
  return {};
}

async function applyDeload(
  clientId: string,
  pause: PlanPause,
  resumeDate: string,
): Promise<{ error?: string }> {
  await ensureOriginalDates(clientId);

  const duration = daysBetween(pause.pause_start, resumeDate);

  const { data: futureWeeks, error: fetchErr } = await supabaseAdmin
    .from("program_schedule")
    .select("*")
    .eq("client_id", clientId)
    .gte("start_date", pause.pause_start)
    .order("week_number", { ascending: true });

  if (fetchErr) return { error: fetchErr.message };
  if (!futureWeeks || futureWeeks.length === 0) {
    return {};
  }

  const deloadStart = resumeDate;
  const deloadEnd = addDays(resumeDate, 6);

  const { error: insertErr } = await supabaseAdmin.from("program_schedule").insert({
    client_id: clientId,
    week_number: 0,
    sheet_name: "DELOAD",
    is_deload: true,
    focus: "Разгрузка (восстановление после паузы)",
    start_date: deloadStart,
    end_date: deloadEnd,
    original_start_date: deloadStart,
    original_end_date: deloadEnd,
    status: "active",
  });

  if (insertErr) return { error: insertErr.message };

  const shiftDays = duration + 7;

  const results = await Promise.allSettled(
    futureWeeks
      .filter((w) => w.start_date && w.end_date)
      .map((week) =>
        supabaseAdmin
          .from("program_schedule")
          .update({
            start_date: addDays(week.start_date!, shiftDays),
            end_date: addDays(week.end_date!, shiftDays),
          })
          .eq("id", week.id),
      ),
  );

  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length > 0) {
    return { error: `Failed to update ${failures.length} schedule entries` };
  }

  return {};
}

async function applyRollback(
  clientId: string,
  pause: PlanPause,
  resumeDate: string,
): Promise<{ error?: string }> {
  await ensureOriginalDates(clientId);

  const { data: lastWorkout } = await supabaseAdmin
    .from("workout_logs")
    .select("date, week")
    .eq("client_id", clientId)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const rollbackWeekNumber = lastWorkout?.week ?? 1;

  const { data: rollbackWeek } = await supabaseAdmin
    .from("program_schedule")
    .select("*")
    .eq("client_id", clientId)
    .eq("week_number", rollbackWeekNumber)
    .maybeSingle();

  if (!rollbackWeek) {
    return {};
  }

  const originalStart = rollbackWeek.original_start_date ?? rollbackWeek.start_date ?? resumeDate;
  const originalEnd = rollbackWeek.original_end_date ?? rollbackWeek.end_date ?? resumeDate;
  const weekDuration = daysBetween(originalStart, originalEnd) + 1;

  const repeatStart = resumeDate;
  const repeatEnd = addDays(resumeDate, weekDuration - 1);

  const { data: futureWeeks, error: fetchErr } = await supabaseAdmin
    .from("program_schedule")
    .select("id, start_date, end_date, week_number")
    .eq("client_id", clientId)
    .gte("start_date", pause.pause_start)
    .order("week_number", { ascending: true });

  if (fetchErr) return { error: fetchErr.message };

  const { error: insertErr } = await supabaseAdmin.from("program_schedule").insert({
    client_id: clientId,
    week_number: rollbackWeekNumber,
    sheet_name: rollbackWeek.sheet_name ? `${rollbackWeek.sheet_name}_REPEAT` : null,
    is_deload: false,
    focus: rollbackWeek.focus ? `${rollbackWeek.focus} (повтор)` : "Повтор",
    start_date: repeatStart,
    end_date: repeatEnd,
    original_start_date: originalStart,
    original_end_date: originalEnd,
    status: "active",
  });

  if (insertErr) return { error: insertErr.message };

  if (futureWeeks && futureWeeks.length > 0) {
    const shiftDays = daysBetween(pause.pause_start, resumeDate) + weekDuration;
    const results = await Promise.allSettled(
      futureWeeks
        .filter((w) => w.start_date && w.end_date)
        .map((week) =>
          supabaseAdmin
            .from("program_schedule")
            .update({
              start_date: addDays(week.start_date!, shiftDays),
              end_date: addDays(week.end_date!, shiftDays),
            })
            .eq("id", week.id),
        ),
    );

    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      return { error: `Failed to update ${failures.length} schedule entries` };
    }
  }

  return {};
}

export async function getEffectiveSchedule(clientId: string): Promise<EffectiveWeek[]> {
  const activePause = await getActivePause(clientId);

  const { data: schedule } = await supabaseAdmin
    .from("program_schedule")
    .select("*")
    .eq("client_id", clientId)
    .order("week_number", { ascending: true });

  if (!schedule) return [];

  return schedule.map((week) => {
    const isPaused =
      activePause !== null &&
      week.start_date !== null &&
      week.start_date >= activePause.pause_start &&
      (activePause.pause_end === null || week.start_date <= activePause.pause_end);

    return {
      ...week,
      is_paused: isPaused,
    };
  });
}

export async function generateSchedule(
  clientId: string,
  programId: string,
): Promise<{ error?: string }> {
  const { data: existing } = await supabaseAdmin
    .from("program_schedule")
    .select("id")
    .eq("client_id", clientId)
    .limit(1);

  if (existing && existing.length > 0) {
    return {};
  }

  const { data: program } = await supabaseAdmin
    .from("programs")
    .select("*")
    .eq("id", programId)
    .maybeSingle();

  if (!program) {
    return { error: "Программа не найдена" };
  }

  const programRow = program as Database["public"]["Tables"]["programs"]["Row"];
  const parsed = getParsedContent(programRow);

  if (!parsed?.weeks || parsed.weeks.length === 0) {
    return { error: "В программе нет недель для генерации расписания" };
  }

  const today = todayStr();
  const scheduleEntries = parsed.weeks.map((week) => {
    const weekOffset = (week.week_number - 1) * 7;
    const startDate = addDays(today, weekOffset);
    const endDate = addDays(today, weekOffset + 6);

    return {
      client_id: clientId,
      week_number: week.week_number,
      sheet_name: `W${week.week_number}`,
      is_deload: week.is_deload ?? false,
      start_date: startDate,
      end_date: endDate,
      original_start_date: startDate,
      original_end_date: endDate,
      focus: week.week_label ?? null,
      status: "active",
    };
  });

  const { error } = await supabaseAdmin
    .from("program_schedule")
    .insert(scheduleEntries);

  if (error) return { error: error.message };
  return {};
}
