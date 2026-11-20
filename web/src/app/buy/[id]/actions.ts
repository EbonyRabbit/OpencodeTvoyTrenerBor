"use server";

import { headers } from "next/headers";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendTelegramMessage } from "@/lib/telegram";
import { normalizeTelegramUsername } from "@/lib/validation";
import {
  DEDUP_ERROR_MESSAGE,
  COACH_REQUEST_ALREADY_SENT_MESSAGE,
  buildCoachRequestCoachMessage,
} from "@/lib/purchase";
import { PRIVACY_POLICY_VERSION } from "@/lib/consent";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

const DEDUP_WINDOW_MS = 900_000;
const dedupMap = new Map<string, number>();

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitMap.delete(ip);
    }
  }
  for (const [key, ts] of dedupMap) {
    if (now - ts > DEDUP_WINDOW_MS) {
      dedupMap.delete(key);
    }
  }
}, DEDUP_WINDOW_MS);

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

async function insertBotLog(
  action: string,
  status: string,
  telegramId: number | null,
  details: unknown,
): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.from("bot_logs").insert({
      action,
      status,
      telegram_id: telegramId,
      details: JSON.stringify(details),
    });
    if (error) {
      console.error(`[BOT_LOG] Failed to log ${action}:`, error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[BOT_LOG] Failed to log ${action}:`, e);
    return false;
  }
}

async function deleteDedupKey(key: string): Promise<void> {
  await supabaseAdmin
    .from("bot_dedup")
    .delete()
    .eq("key", key)
    .then(
      () => {},
      (delErr) => console.error("[DEDUP] Failed to delete dedup key:", delErr),
    );
}

const GENERIC_ERROR_MESSAGE = "Произошла ошибка. Попробуйте позже.";

export type CoachRequestInput = {
  username: string;
  consentGiven: boolean;
  age18: boolean;
};

function hashUsername(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function findPendingIndividByUsername(username: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("purchase_requests")
    .select("id, name")
    .eq("sub_type", "individ")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`Pending individ username check failed: ${error.message}`);
  }
  const needle = `@${username}`;
  return (data ?? []).some(
    (row) => typeof row.name === "string" && row.name.toLowerCase() === needle,
  );
}

export async function createCoachRequest(
  input: CoachRequestInput,
): Promise<{ error?: string }> {
  let dedupKey = "";
  let dbDedupKey = "";
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (isRateLimited(ip)) {
      return { error: "Слишком много заявок. Попробуйте позже." };
    }

    const username = normalizeTelegramUsername(input.username);
    if (!username) {
      return { error: "Укажите Telegram username (например, @username)." };
    }
    const displayName = `@${username}`;

    if (typeof input.age18 !== "boolean" || !input.age18) {
      return { error: "Необходимо подтвердить, что вам исполнилось 18 лет." };
    }

    if (typeof input.consentGiven !== "boolean" || !input.consentGiven) {
      return { error: "Необходимо согласие на обработку персональных данных." };
    }

    // Веб-строки идентифицируются только username: параметр ?tg= на публичной
    // странице не аутентифицирован, поэтому запись чужого ID заблокировала бы
    // чужой pending-слот. Дедупликация строится на нормализованном username.
    const now = Date.now();
    dedupKey = `${ip}:individ:${username}`;
    if (
      dedupMap.has(dedupKey) &&
      now - (dedupMap.get(dedupKey) ?? 0) < DEDUP_WINDOW_MS
    ) {
      return { error: DEDUP_ERROR_MESSAGE };
    }
    dedupMap.set(dedupKey, now);

    const pendingExists = await findPendingIndividByUsername(username);
    if (pendingExists) {
      dedupMap.delete(dedupKey);
      return { error: COACH_REQUEST_ALREADY_SENT_MESSAGE };
    }

    dbDedupKey = `individ:${hashUsername(username)}`;
    const nowIso = new Date().toISOString();
    const { error: purgeError } = await supabaseAdmin
      .from("bot_dedup")
      .delete()
      .eq("key", dbDedupKey)
      .lt("expires_at", nowIso);
    if (purgeError) {
      console.error(
        "[COACH_REQUEST] Failed to purge expired dedup key:",
        purgeError.message,
      );
    }

    const { error: dedupError } = await supabaseAdmin.from("bot_dedup").insert({
      key: dbDedupKey,
      expires_at: new Date(Date.now() + DEDUP_WINDOW_MS).toISOString(),
    });
    if (dedupError?.code === "23505") {
      return { error: DEDUP_ERROR_MESSAGE };
    }
    if (dedupError) {
      console.error(
        "[COACH_REQUEST] Failed to write dedup key:",
        dedupError.message,
      );
      dedupMap.delete(dedupKey);
      return { error: GENERIC_ERROR_MESSAGE };
    }

    const { data: request, error: insertError } = await supabaseAdmin
      .from("purchase_requests")
      .insert({
        sub_type: "individ",
        name: displayName,
        status: "pending",
        consent_given: true,
        consent_at: new Date().toISOString(),
        consent_version: PRIVACY_POLICY_VERSION,
        telegram_id: null,
      })
      .select("id")
      .maybeSingle<{ id: string }>();
    if (insertError) {
      console.error(
        "[COACH_REQUEST] Failed to insert request:",
        insertError.message,
      );
      dedupMap.delete(dedupKey);
      await deleteDedupKey(dbDedupKey);
      return { error: GENERIC_ERROR_MESSAGE };
    }

    await insertBotLog("coach_request", "info", null, {
      purchase_request_id: request?.id ?? null,
      sub_type: "individ",
    });

    const coachChatId = process.env.COACH_CHAT_ID;
    const logNotificationFailure = async (reason: string) => {
      await insertBotLog(
        "coach_request:coach_notification_failed",
        "error",
        null,
        {
          purchase_request_id: request?.id ?? null,
          reason,
        },
      );
    };

    if (coachChatId) {
      const sent = await sendTelegramMessage(
        coachChatId,
        buildCoachRequestCoachMessage({ name: displayName }),
      );
      if (!sent) {
        console.error("[COACH_REQUEST] Coach notification failed");
        await logNotificationFailure("telegram_send_failed");
      }
    } else {
      console.error("[COACH_REQUEST] COACH_CHAT_ID is not set");
      await logNotificationFailure("COACH_CHAT_ID_not_set");
    }

    return {};
  } catch (e) {
    console.error("[COACH_REQUEST] createCoachRequest error:", e);
    if (dedupKey) dedupMap.delete(dedupKey);
    if (dbDedupKey) await deleteDedupKey(dbDedupKey);
    return { error: GENERIC_ERROR_MESSAGE };
  }
}
