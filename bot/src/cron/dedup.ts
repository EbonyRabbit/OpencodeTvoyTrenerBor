import { supabaseAdmin } from "../lib/supabase-admin.js";

const DEFAULT_TTL_HOURS = 25;
const CLEANUP_BATCH_LIMIT = 500;
const MAX_KEY_LENGTH = 255;

export type DedupResult = "sent" | "duplicate" | "error";

export async function markAsSent(key: string, ttlHours = DEFAULT_TTL_HOURS): Promise<DedupResult> {
  if (!key || typeof key !== "string" || key.length > MAX_KEY_LENGTH) {
    console.error(`[DEDUP] Invalid key: "${String(key).slice(0, 30)}…"`);
    return "error";
  }

  const expiresAt = new Date(Date.now() + ttlHours * 3600_000).toISOString();

  // TODO: regenerate Supabase types after adding bot_dedup table
  const { error } = await supabaseAdmin
    .from("bot_dedup")
    .insert({ key, expires_at: expiresAt } as never);

  if (error) {
    if (error.code === "23505") {
      return "duplicate";
    }
    console.error(`[DEDUP] Insert error for key "${key.slice(0, 30)}…":`, error.code);
    return "error";
  }

  return "sent";
}

export async function cleanupExpired(): Promise<void> {
  const { error } = await supabaseAdmin
    .from("bot_dedup")
    .delete()
    .lt("expires_at", new Date().toISOString())
    .limit(CLEANUP_BATCH_LIMIT);

  if (error) {
    console.error("[DEDUP] Cleanup error:", error.code);
  }
}
