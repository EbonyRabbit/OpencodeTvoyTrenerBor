import { supabaseAdmin } from "./supabase-admin.js";
import { getParsedContent, type ParsedContent } from "./program-utils.js";
import { addDays } from "./date-utils.js";

export const NIL_PERIOD_ID = "00000000-0000-0000-0000-000000000000";

export type ActiveProgramPeriod = {
  id: string;
  program_id: string | null;
};

// The active row of client_program_periods is the single source of truth for
// "which program period the client is in". All per-period reads (today's
// workout, weight hints, e1RM targets, adherence) filter by it; exercise
// history and general history intentionally show every period.
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
    console.error(`[PERIOD] Active period lookup failed for ${clientId}:`, error.message);
    return null;
  }
  return data ?? null;
}

export type ScheduleEntryInput = {
  week_number: number;
  sheet_name: string;
  is_deload: boolean;
  start_date: string;
  end_date: string;
  original_start_date: string;
  original_end_date: string;
  focus: string | null;
  status: string;
};

// Week rows for a fresh period: week N starts today + (N-1)*7 days, mirrors
// the web builder so bot- and web-issued switches produce identical rows.
export function buildScheduleEntries(
  parsed: ParsedContent | null,
  today: string,
): ScheduleEntryInput[] | null {
  if (!parsed?.weeks || parsed.weeks.length === 0) return null;
  return parsed.weeks.map((week) => {
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
  });
}

// Atomic program (re)assignment for the subscribe flow: closes the current
// period, archives its schedule and starts the chosen program from week 1.
export async function switchProgramPeriod(
  clientId: string,
  programId: string,
  parsed: ParsedContent | null,
): Promise<{ error?: string }> {
  const today = new Date().toISOString().split("T")[0];
  const entries = buildScheduleEntries(parsed, today);
  if (!entries) {
    return { error: "В программе нет недель для генерации расписания." };
  }
  const { error } = await supabaseAdmin.rpc("start_program_period", {
    p_client_id: clientId,
    p_program_id: programId,
    p_schedule: entries,
  });
  if (error) {
    console.error(`[PERIOD] Switch failed for ${clientId}:`, error.message);
    return { error: error.message };
  }
  return {};
}
