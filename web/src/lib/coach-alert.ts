import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendTelegramMessage } from "@/lib/telegram";

const ALERT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * At-least-once coach alert. The dedup row is written only after Telegram
 * accepted the message, so a crash or a failed insert can duplicate an alert
 * but never suppress a real one. A delivered alert is reported as true even
 * if the dedup write fails.
 */
export async function sendCoachAlertOnce(
  key: string,
  text: string,
): Promise<boolean> {
  const coachChatId = process.env.COACH_CHAT_ID;
  if (!coachChatId) {
    console.error(
      "[COACH_ALERT] COACH_CHAT_ID is not set; alert not delivered:",
      key,
    );
    return false;
  }
  const now = new Date();
  const nowIso = now.toISOString();
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("bot_dedup")
    .select("key")
    .eq("key", key)
    .gt("expires_at", nowIso)
    .maybeSingle();
  if (lookupError) {
    console.error(
      "[COACH_ALERT] Dedup lookup failed:",
      lookupError.message,
    );
  } else if (existing) {
    return true;
  }

  try {
    const sent = await sendTelegramMessage(coachChatId, text);
    if (!sent) return false;
  } catch (err) {
    console.error(
      "[COACH_ALERT] Telegram send error:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }

  const expiresAt = new Date(now.getTime() + ALERT_TTL_MS).toISOString();
  const { error: insertError } = await supabaseAdmin
    .from("bot_dedup")
    .insert({ key, expires_at: expiresAt });
  if (!insertError) return true;
  if (insertError.code !== "23505") {
    console.error("[COACH_ALERT] Dedup insert failed:", insertError.message);
    return true;
  }

  // Expired key or a concurrent insert won. Replace the stale row once; if
  // this fails, the alert is still delivered that one extra time on retry.
  const { error: deleteError } = await supabaseAdmin
    .from("bot_dedup")
    .delete()
    .eq("key", key)
    .lt("expires_at", nowIso);
  if (deleteError) {
    console.error("[COACH_ALERT] Dedup purge failed:", deleteError.message);
    return true;
  }
  const { error: retryError } = await supabaseAdmin
    .from("bot_dedup")
    .insert({ key, expires_at: expiresAt });
  if (retryError) {
    console.error("[COACH_ALERT] Dedup retry failed:", retryError.message);
  }
  return true;
}
