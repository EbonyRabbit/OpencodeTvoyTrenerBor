import { supabaseAdmin } from "./supabase-admin.js";
import type { Database } from "./types.js";

export type Client = Database["public"]["Tables"]["clients"]["Row"];

export async function findClientByTelegramId(telegramId: number): Promise<Client | null> {
  if (!Number.isInteger(telegramId) || telegramId <= 0) {
    throw new Error(`Invalid telegramId: ${telegramId}`);
  }

  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("*")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (error) {
    console.error(`[DB] findClientByTelegramId(${telegramId}) error:`, error.message);
    throw new Error(`Database query failed: ${error.message}`);
  }

  return data;
}
