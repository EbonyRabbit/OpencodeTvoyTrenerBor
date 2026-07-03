import { supabaseAdmin } from "../lib/supabase-admin.js";

export type LogStatus = "ok" | "error" | "skipped";

export async function logBotEvent(
  action: string,
  opts: {
    clientId?: string;
    telegramId?: number;
    status?: LogStatus;
    details?: string;
  } = {},
): Promise<void> {
  const { clientId, telegramId, status = "ok", details } = opts;

  try {
    // TODO: regenerate Supabase types after adding bot_logs table
    await supabaseAdmin.from("bot_logs").insert({
      action,
      client_id: clientId ?? null,
      telegram_id: telegramId ?? null,
      status,
      details: details ?? null,
    } as never);
  } catch (err) {
    console.error("[LOG] Failed to write bot_log:", err instanceof Error ? err.message : "unknown");
  }
}
