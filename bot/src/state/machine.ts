import { supabaseAdmin } from "../lib/supabase-admin.js";
import type { Database, Json } from "../lib/types.js";

type BotStateRow = Database["public"]["Tables"]["bot_state"]["Row"];

export interface BotState {
  telegram_id: number;
  action: string | null;
  step: string | null;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SetStatePayload {
  action: string;
  step: string;
  data?: Record<string, unknown>;
}

const STALE_STATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function isValidTelegramId(id: number): boolean {
  return Number.isInteger(id) && id > 0;
}

function rowToState(row: BotStateRow): BotState {
  const raw = row.data;
  let data: Record<string, unknown>;
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    data = raw as Record<string, unknown>;
  } else {
    if (raw !== null) {
      console.warn(`[STATE] Invalid data format for telegram_id ${row.telegram_id}:`, typeof raw);
    }
    data = {};
  }
  return {
    telegram_id: row.telegram_id,
    action: row.action,
    step: row.step,
    data,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toJson(data: Record<string, unknown>): Json {
  try {
    return JSON.parse(JSON.stringify(data)) as Json;
  } catch (err) {
    console.error("[STATE] toJson serialization error:", err);
    return {};
  }
}

export async function getState(telegramId: number): Promise<BotState | null> {
  if (!isValidTelegramId(telegramId)) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("bot_state")
    .select("*")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (error) {
    console.error(`[STATE] getState(${telegramId}) error:`, error.message);
    return null;
  }

  if (!data) return null;

  const age = Date.now() - new Date(data.updated_at).getTime();
  if (isNaN(age) || age > STALE_STATE_MAX_AGE_MS) {
    console.log(
      `[STATE] Stale state for ${telegramId} (${Math.round(age / 3600000)}h old), clearing`,
    );
    const { error: deleteError } = await supabaseAdmin
      .from("bot_state")
      .delete()
      .eq("telegram_id", telegramId)
      .lt("updated_at", new Date(Date.now() - STALE_STATE_MAX_AGE_MS).toISOString());
    if (deleteError) {
      console.error(`[STATE] clearStaleState(${telegramId}) error:`, deleteError.message);
    }
    return null;
  }

  return rowToState(data);
}

export async function setState(
  telegramId: number,
  payload: SetStatePayload,
  existingState?: BotState | null,
): Promise<void> {
  if (!isValidTelegramId(telegramId)) {
    throw new Error(`setState: invalid telegramId ${telegramId}`);
  }
  if (!payload.action?.trim() || !payload.step?.trim()) {
    throw new Error("setState: action and step are required");
  }

  const shouldClearData = existingState && existingState.action !== payload.action;
  const mergedData = shouldClearData
    ? (payload.data ?? {})
    : { ...existingState?.data, ...payload.data };

  const { error } = await supabaseAdmin.from("bot_state").upsert(
    {
      telegram_id: telegramId,
      action: payload.action.trim(),
      step: payload.step.trim(),
      data: toJson(mergedData),
    },
    { onConflict: "telegram_id" },
  );

  if (error) {
    console.error(`[STATE] setState(${telegramId}) error:`, error.message);
    throw new Error(`Failed to save state: ${error.message}`);
  }
}

export async function clearState(telegramId: number): Promise<void> {
  if (!isValidTelegramId(telegramId)) {
    throw new Error(`clearState: invalid telegramId ${telegramId}`);
  }

  const { error } = await supabaseAdmin
    .from("bot_state")
    .delete()
    .eq("telegram_id", telegramId);

  if (error) {
    console.error(`[STATE] clearState(${telegramId}) error:`, error.message);
    throw new Error(`Failed to clear state: ${error.message}`);
  }
}

export async function mergeStateData(
  telegramId: number,
  additionalData: Record<string, unknown>,
): Promise<void> {
  if (!isValidTelegramId(telegramId)) {
    throw new Error(`mergeStateData: invalid telegramId ${telegramId}`);
  }

  const serialized = toJson(additionalData);

  const { data: current, error: readError } = await supabaseAdmin
    .from("bot_state")
    .select("data")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (readError) {
    console.error(`[STATE] mergeStateData read(${telegramId}) error:`, readError.message);
    throw new Error(`Failed to read state for merge: ${readError.message}`);
  }

  if (!current) return;

  const existing = current.data;
  const merged =
    existing !== null && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>), ...(serialized as Record<string, unknown>) }
      : serialized;

  const { error } = await supabaseAdmin
    .from("bot_state")
    .update({ data: toJson(merged as Record<string, unknown>) })
    .eq("telegram_id", telegramId);

  if (error) {
    console.error(`[STATE] mergeStateData write(${telegramId}) error:`, error.message);
    throw new Error(`Failed to merge state data: ${error.message}`);
  }
}
