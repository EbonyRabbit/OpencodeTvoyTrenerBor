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

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 3600_000).toISOString();

  const insert = () =>
    supabaseAdmin.from("bot_dedup").insert({ key, expires_at: expiresAt });
  const { error } = await insert();

  if (error) {
    if (error.code !== "23505") {
      console.error(`[DEDUP] Insert error for key "${key.slice(0, 30)}…":`, error.code);
      return "error";
    }
    // Уникальный ключ может остаться от прошлого TTL: чистим только по
    // конфликту, а не DELETE перед каждой отправкой.
    const { error: purgeError } = await supabaseAdmin
      .from("bot_dedup")
      .delete()
      .eq("key", key)
      .lt("expires_at", now.toISOString());
    if (purgeError) {
      console.error(`[DEDUP] Purge error for key "${key.slice(0, 30)}…":`, purgeError.code);
      return "error";
    }
    const { error: retryError } = await insert();
    if (retryError) {
      if (retryError.code === "23505") return "duplicate";
      console.error(`[DEDUP] Retry error for key "${key.slice(0, 30)}…":`, retryError.code);
      return "error";
    }
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

export async function deleteDedup(key: string): Promise<boolean> {
  if (!key || typeof key !== "string" || key.length > MAX_KEY_LENGTH) {
    return false;
  }

  const { error } = await supabaseAdmin
    .from("bot_dedup")
    .delete()
    .eq("key", key);

  if (error) {
    console.error(`[DEDUP] Delete error for key "${key.slice(0, 30)}…":`, error.code);
    return false;
  }
  return true;
}

export type ExistsResult = boolean | "error";

export async function isSent(key: string): Promise<ExistsResult> {
  if (!key || typeof key !== "string" || key.length > MAX_KEY_LENGTH) return false;

  const { data, error } = await supabaseAdmin
    .from("bot_dedup")
    .select("key")
    .eq("key", key)
    .gt("expires_at", new Date().toISOString())
    .limit(1);

  if (error) {
    console.error(`[DEDUP] Exists check error for key "${key.slice(0, 30)}…":`, error.code);
    return "error";
  }

  return (data?.length ?? 0) > 0;
}
