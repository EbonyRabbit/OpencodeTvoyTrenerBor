import { supabaseAdmin } from "./supabase-admin.js";
import type { Database, PauseReason, ResumeStrategy } from "./types.js";
import { daysBetween, addDays } from "./date-utils.js";
import { getActiveProgramPeriod } from "./program-periods.js";

export type PlanPause = Database["public"]["Tables"]["plan_pauses"]["Row"];

export type { PauseReason, ResumeStrategy };

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

export type PauseCreateResult =
  | { ok: true }
  | { ok: false; code: "ALREADY_ACTIVE" | "DB_ERROR"; details?: string };

export async function createPause(
  clientId: string,
  pauseStart: string,
  reason: PauseReason,
  plannedResumeDate?: string | null,
): Promise<PauseCreateResult> {
  const existing = await getActivePause(clientId);
  if (existing) {
    return { ok: false, code: "ALREADY_ACTIVE" };
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

  if (error) return { ok: false, code: "DB_ERROR", details: error.message };
  return { ok: true };
}

async function claimPause(pauseId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("plan_pauses")
    .update({ status: "resuming" })
    .eq("id", pauseId)
    .eq("status", "active")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[PLAN_ADJUSTMENT] Failed to claim pause:", error.code);
    return false;
  }

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

  // 30.7: откат атомарен в SQL RPC (хвост 30.6-1) — архив, REPEAT-неделя,
  // сдвиг будущих недель и завершение паузы в одной транзакции.
  if (strategy === "rollback") {
    try {
      const { error } = await supabaseAdmin.rpc("apply_program_rollback", {
        p_client_id: clientId,
        p_pause_id: pause.id,
        p_resume_date: resumeDate,
      });
      if (error) {
        await revertToActive(pause.id);
        return { error: error.message };
      }
      return {};
    } catch (err) {
      await revertToActive(pause.id);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  let result: { error?: string };

  try {
    if (strategy === "shift") {
      result = await applyShift(clientId, pause, resumeDate);
    } else if (strategy === "skip") {
      result = await applySkip(clientId, pause, resumeDate);
    } else if (strategy === "deload") {
      result = await applyDeload(clientId, pause, resumeDate);
    } else {
      result = { error: "Неизвестная стратегия" };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await revertToActive(pause.id);
    return { error: msg };
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
  // 30.6: касаемся только недель активного периода.
  const period = await getActiveProgramPeriod(clientId);
  if (!period) return;

  const { data: schedule, error: fetchErr } = await supabaseAdmin
    .from("program_schedule")
    .select("id, start_date, end_date, original_start_date, original_end_date")
    .eq("client_id", clientId)
    .eq("program_period_id", period.id)
    .is("original_start_date", null);

  if (fetchErr || !schedule || schedule.length === 0) return;

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

  // 30.6: сдвиг будущих недель — внутри активного периода.
  const period = await getActiveProgramPeriod(clientId);
  if (!period) return {};

  const duration = daysBetween(pause.pause_start, resumeDate);

  const { data: weeks, error: fetchErr } = await supabaseAdmin
    .from("program_schedule")
    .select("id, start_date, end_date")
    .eq("client_id", clientId)
    .eq("program_period_id", period.id)
    .neq("status", "archived")
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

  // 30.6: разгрузка ставится внутри активного периода.
  const period = await getActiveProgramPeriod(clientId);
  if (!period) return {};

  const duration = daysBetween(pause.pause_start, resumeDate);

  const { data: futureWeeks, error: fetchErr } = await supabaseAdmin
    .from("program_schedule")
    .select("*")
    .eq("client_id", clientId)
    .eq("program_period_id", period.id)
    .neq("status", "archived")
    .gte("start_date", pause.pause_start)
    .order("week_number", { ascending: true });

  if (fetchErr) return { error: fetchErr.message };
  if (!futureWeeks || futureWeeks.length === 0) {
    return {};
  }

  const deloadStart = resumeDate;
  const deloadEnd = addDays(resumeDate, 6);

  // Хвост 30.5: если после прошлого отката осталась живая W0, архивируем её,
  // иначе повторная разгрузка создаст дубль недели 0.
  const { error: w0ArchiveErr } = await supabaseAdmin
    .from("program_schedule")
    .update({ status: "archived" })
    .eq("client_id", clientId)
    .eq("program_period_id", period.id)
    .eq("week_number", 0)
    .neq("status", "archived");
  if (w0ArchiveErr) return { error: w0ArchiveErr.message };

  const { error: insertErr } = await supabaseAdmin.from("program_schedule").insert({
    client_id: clientId,
    program_id: period.program_id,
    program_period_id: period.id,
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

