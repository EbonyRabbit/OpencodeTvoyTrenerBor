import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Database } from "@/types/supabase";
import { buildScheduleEntries } from "@/lib/plan-adjustment";
import type { HistoryPeriodOption } from "@/lib/history-periods";

// Phase 30.5: assigning a program to a client is one atomic RPC
// (start_program_period in migration 20261111000200). It closes the old
// period, archives the old schedule, closes pauses, stamps pre-period logs,
// creates the new period and inserts its schedule rows. Old rows are never
// deleted; weights reset because per-period history filters by the new period.
export async function startProgramPeriod(
  clientId: string,
  programId: string,
): Promise<{ error?: string }> {
  const { data: program, error: programError } = await supabaseAdmin
    .from("programs")
    .select("*")
    .eq("id", programId)
    .eq("active", true)
    .maybeSingle();
  if (programError) {
    console.error("[PERIOD] Program lookup failed:", programError.message);
    return { error: "Не удалось проверить программу." };
  }
  if (!program) return { error: "Программа не найдена." };

  const { entries, error: entriesError } = buildScheduleEntries(
    program as Database["public"]["Tables"]["programs"]["Row"],
  );
  if (entriesError || !entries) {
    console.error("[PERIOD] Schedule build failed:", entriesError);
    return { error: entriesError ?? "Не удалось подготовить расписание." };
  }

  const { error: rpcError } = await supabaseAdmin.rpc("start_program_period", {
    p_client_id: clientId,
    p_program_id: programId,
    p_schedule: entries,
  });
  if (rpcError) {
    console.error("[PERIOD] Switch failed:", rpcError.message);
    if (rpcError.message.includes("CLIENT_NOT_FOUND"))
      return { error: "Клиент не найден." };
    if (rpcError.message.includes("PROGRAM_NOT_FOUND"))
      return { error: "Программа недоступна." };
    return { error: "Не удалось назначить программу и расписание." };
  }
  return {};
}

export const NIL_PERIOD_ID = "00000000-0000-0000-0000-000000000000";

export type ActiveProgramPeriod = {
  id: string;
  program_id: string | null;
};

// The single active row in client_program_periods. Per-period reads (current
// week, adherence, targets) filter by it; general history shows all periods.
export async function getActiveProgramPeriod(
  clientId: string,
): Promise<ActiveProgramPeriod | null> {
  const { data, error } = await supabaseAdmin
    .from("client_program_periods")
    .select("id, program_id")
    .eq("client_id", clientId)
    .eq("status", "active")
    .maybeSingle();
  if (error) {
    console.error("[PERIOD] Active period lookup failed:", error.message);
    return null;
  }
  return data ?? null;
}

export async function listProgramPeriods(
  clientId: string,
): Promise<{ periods: HistoryPeriodOption[]; error?: string }> {
  const { data, error } = await supabaseAdmin
    .from("client_program_periods")
    .select("id, program_id, started_at, ended_at, status")
    .eq("client_id", clientId)
    .order("started_at", { ascending: false });
  if (error) {
    console.error("[PERIOD] Period list failed:", error.message);
    return { periods: [], error: error.message };
  }

  const periods = (data ?? []) as Array<{
    id: string;
    program_id: string | null;
    started_at: string;
    ended_at: string | null;
    status: string;
  }>;
  const programIds = [...new Set(periods.map((period) => period.program_id))].filter(
    (id): id is string => Boolean(id),
  );
  const { data: programs, error: programsError } = programIds.length
    ? await supabaseAdmin
        .from("programs")
        .select("id, title")
        .in("id", programIds)
    : { data: [], error: null };
  if (programsError) {
    console.error("[PERIOD] Period program titles failed:", programsError.message);
  }
  const titles = new Map(
    ((programs ?? []) as Array<{ id: string; title: string }>).map((program) => [
      program.id,
      program.title,
    ]),
  );

  return {
    periods: periods.map((period) => ({
      id: period.id,
      programId: period.program_id,
      programTitle: period.program_id ? titles.get(period.program_id) ?? "Без программы" : "Без программы",
      startedAt: period.started_at,
      endedAt: period.ended_at,
      status: period.status,
    })),
  };
}
