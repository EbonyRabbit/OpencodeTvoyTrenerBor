import { supabaseAdmin } from "./supabase-admin.js";
import type { Database } from "./types.js";

export type Client = Database["public"]["Tables"]["clients"]["Row"];

const TELEGRAM_USERNAME_REGEX = /^[a-z0-9_]{4,32}$/;
const FALLBACK_NAME_REGEX = /^Клиент #[A-Z0-9]{6}$/;

export function normalizeTelegramUsername(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^@+/, "").toLowerCase();
  return TELEGRAM_USERNAME_REGEX.test(normalized) ? normalized : null;
}

export function telegramDisplayName(
  username: string | null | undefined,
  seed: string,
): string {
  const normalized = normalizeTelegramUsername(username);
  if (normalized) return `@${normalized}`;
  const suffix = (seed.replace(/[^a-zA-Z0-9]/g, "").slice(-6) || "000000").toUpperCase().padStart(6, "0");
  return `Клиент #${suffix}`;
}

export async function syncClientName(
  client: Client,
  username?: string | null,
  existingName?: string | null,
): Promise<Client>;
export async function syncClientName(
  clientId: string,
  username?: string | null,
  existingName?: string | null,
): Promise<string>;
export async function syncClientName(
  clientOrId: Client | string,
  username?: string | null,
  existingName?: string | null,
): Promise<Client | string> {
  const clientId = typeof clientOrId === "string" ? clientOrId : clientOrId.id;
  const currentName = existingName ?? (typeof clientOrId === "string" ? null : clientOrId.name);
  const normalized = normalizeTelegramUsername(username);
  const nextName = normalized
    ? `@${normalized}`
    : currentName && FALLBACK_NAME_REGEX.test(currentName)
      ? currentName
      : telegramDisplayName(null, clientId);

  if (nextName !== currentName) {
    const { error } = await supabaseAdmin
      .from("clients")
      .update({ name: nextName })
      .eq("id", clientId);
    if (error) {
      console.error(`[DB] syncClientName(${clientId}) error:`, error.message);
      throw new Error(`Database update failed: ${error.message}`);
    }
  }

  if (typeof clientOrId !== "string") {
    clientOrId.name = nextName;
    return clientOrId;
  }
  return nextName;
}

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
