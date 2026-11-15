import { supabaseAdmin } from "./supabase-admin.js";

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
