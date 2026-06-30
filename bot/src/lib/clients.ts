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

export async function findClientByConnectCode(code: string): Promise<Client | null> {
  const normalized = code.trim().toUpperCase();

  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("*")
    .eq("connect_code", normalized)
    .is("telegram_id", null)
    .maybeSingle();

  if (error) {
    console.error(`[DB] findClientByConnectCode(${normalized}) error:`, error.message);
    throw new Error(`Database query failed: ${error.message}`);
  }

  return data;
}

export async function connectClientToTelegram(
  clientId: string,
  telegramId: number
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .update({
      telegram_id: telegramId,
      connect_code: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientId)
    .is("telegram_id", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error(`[DB] connectClientToTelegram(${clientId}) error:`, error.message);
    throw new Error(`Database update failed: ${error.message}`);
  }

  if (!data) {
    throw new Error("Account was already connected");
  }
}
