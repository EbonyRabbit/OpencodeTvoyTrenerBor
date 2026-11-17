import { supabaseAdmin } from "./supabase-admin";
import { getParsedContent } from "./program-utils";
import { getActiveProgramPeriod } from "./program-periods";
import type { Database } from "@/types/supabase";
import type { PauseReason, ResumeStrategy } from "@/types/supabase";

export type { PauseReason, ResumeStrategy };

export type PlanPause = Database["public"]["Tables"]["plan_pauses"]["Row"];

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
  pauseEnd?: string | null,
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
      pause_end: pauseEnd ?? null,
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
  // 30.6: касаемся только недель активного периода.
  const period = await getActiveProgramPeriod(clientId);
  if (!period) return;

  const { data: schedule } = await supabaseAdmin
    .from("program_schedule")
    .select("id, start_date, end_date, original_start_date, original_end_date")
    .eq("client_id", clientId)
    .eq("program_period_id", period.id)
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

  // Хвост 30.5: архивируем живую W0 от прошлого отката, иначе повторная
  // разгрузка создаст дубль недели 0.
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

export type ScheduleEntry = Omit<
  Database["public"]["Tables"]["program_schedule"]["Insert"],
  "id" | "created_at" | "updated_at" | "client_id" | "program_id" | "program_period_id"
>;

export function buildScheduleEntries(
  program: Database["public"]["Tables"]["programs"]["Row"],
): { entries?: ScheduleEntry[]; error?: string } {
  const parsed = getParsedContent(program);

  if (!parsed?.weeks || parsed.weeks.length === 0) {
    return { error: "В программе нет недель для генерации расписания" };
  }

  const today = todayStr();
  return {
    entries: parsed.weeks.map((week) => {
      const weekOffset = (week.week_number - 1) * 7;
      const startDate = addDays(today, weekOffset);
      const endDate = addDays(today, weekOffset + 6);

      return {
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
    }),
  };
}
