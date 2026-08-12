"use server";

import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendTelegramMessage } from "@/lib/telegram";
import { formatPrice } from "@/lib/format-price";
import { UUID_REGEX, sanitizeText, isValidContact, formatContact } from "@/lib/validation";
import { DEDUP_ERROR_MESSAGE, parseTelegramId, buildPurchaseCoachMessage, TELEGRAM_USERNAME_REGEX } from "@/lib/purchase";
import type { BuyProgram } from "./buy-form";

const NAME_MAX_LENGTH = 200;
const CONTACT_MAX_LENGTH = 120;

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

export type PurchaseRequestInput = {
  programId: string;
  name: string;
  contact: string;
  telegramId?: string | null;
  telegramUsername?: string | null;
};

export async function createPurchaseRequest(
  input: PurchaseRequestInput,
): Promise<{ error?: string }> {
  let dedupKey = "";
  let dbDedupKey = "";
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (isRateLimited(ip)) {
      return { error: "Слишком много заявок. Попробуйте позже." };
    }

    const programId = input.programId.trim();
    if (!UUID_REGEX.test(programId)) {
      return { error: "Некорректная программа." };
    }

    const name = sanitizeText(input.name);
    if (!name) return { error: "Укажите ваше имя." };
    if (name.length > NAME_MAX_LENGTH) {
      return { error: "Имя слишком длинное." };
    }

    const contact = sanitizeText(input.contact).replace(/^@/, "");
    if (!contact) return { error: "Укажите контакт для связи (Telegram)." };
    if (contact.length > CONTACT_MAX_LENGTH) {
      return { error: "Контакт слишком длинный." };
    }
    if (!isValidContact(contact)) {
      return { error: "Укажите @username или номер телефона." };
    }

    const tgRaw = input.telegramId?.trim() ?? "";
    const telegramId = parseTelegramId(tgRaw);
    if (tgRaw !== "" && telegramId === null) {
      return { error: "Telegram ID — только цифры (от 5 до 15)." };
    }
    const usernameRaw = input.telegramUsername?.trim() ?? "";
    const telegramUsername = TELEGRAM_USERNAME_REGEX.test(usernameRaw) ? usernameRaw : null;

    const now = Date.now();
    dedupKey = `${ip}:${programId}:${contact}`;
    if (dedupMap.has(dedupKey) && now - (dedupMap.get(dedupKey) ?? 0) < DEDUP_WINDOW_MS) {
      return { error: DEDUP_ERROR_MESSAGE };
    }
    dedupMap.set(dedupKey, now);

    const { data: program, error: programError } = await supabaseAdmin
      .from("programs")
      .select("id, title, type, description, duration_weeks, price")
      .eq("id", programId)
      .eq("active", true)
      .eq("type", "template")
      .is("client_id", null)
      .maybeSingle<BuyProgram>();

    if (programError) {
      console.error("[PURCHASE] Program query error:", programError.message);
      dedupMap.delete(dedupKey);
      return { error: "Произошла ошибка. Попробуйте позже." };
    }
    if (!program || program.type !== "template") {
      dedupMap.delete(dedupKey);
      return { error: "Программа недоступна для покупки." };
    }

    dbDedupKey = `purchase:${programId}:${contact.toLowerCase()}`;
    const nowIso = new Date().toISOString();
    const { error: purgeError } = await supabaseAdmin
      .from("bot_dedup")
      .delete()
      .eq("key", dbDedupKey)
      .lt("expires_at", nowIso);
    if (purgeError) {
      console.error("[PURCHASE] Failed to purge expired dedup key:", purgeError.message);
    }

    const { error: dedupError } = await supabaseAdmin.from("bot_dedup").insert({
      key: dbDedupKey,
      expires_at: new Date(Date.now() + DEDUP_WINDOW_MS).toISOString(),
    });
    if (dedupError?.code === "23505") {
      return { error: DEDUP_ERROR_MESSAGE };
    }
    if (dedupError) {
      console.error("[PURCHASE] Failed to write dedup key:", dedupError.message);
    }

    const details = JSON.stringify({
      program_id: program.id,
      program_title: program.title,
      name,
      contact,
      telegram_username: telegramUsername ?? null,
    });

    const { error: logError } = await supabaseAdmin.from("bot_logs").insert({
      action: "purchase_request",
      status: "info",
      telegram_id: telegramId,
      details,
    });
    if (logError) {
      console.error("[PURCHASE] Failed to log purchase request:", logError.message);
      dedupMap.delete(dedupKey);
      await supabaseAdmin.from("bot_dedup").delete().eq("key", dbDedupKey);
      return { error: "Не удалось сохранить заявку. Попробуйте позже." };
    }
    const coachChatId = process.env.COACH_CHAT_ID;

    const logNotificationFailure = async (reason: string) => {
      const { error: logErr } = await supabaseAdmin.from("bot_logs").insert({
        action: "purchase_request:coach_notification_failed",
        status: "error",
        telegram_id: telegramId,
        details: JSON.stringify({
          program_id: program.id,
          contact,
          telegram_username: telegramUsername ?? null,
          reason,
        }),
      });
      if (logErr) {
        console.error("[PURCHASE] Failed to log notification failure:", logErr.message);
      }
    };

    if (coachChatId) {
      const sent = await sendTelegramMessage(
        coachChatId,
        buildPurchaseCoachMessage({
          programTitle: program.title,
          price: program.price,
          durationWeeks: program.duration_weeks,
          name,
          contact,
          telegramUsername,
          telegramId,
          formatContact,
          formatPrice,
        }),
      );
      if (!sent) {
        console.error("[PURCHASE] Coach notification failed");
        await logNotificationFailure("telegram_send_failed");
      }
    } else {
      console.error("[PURCHASE] COACH_CHAT_ID is not set");
      await logNotificationFailure("COACH_CHAT_ID_not_set");
    }

    return {};
  } catch (e) {
    console.error("[PURCHASE] createPurchaseRequest error:", e);
    if (dedupKey) dedupMap.delete(dedupKey);
    if (dbDedupKey) {
      await supabaseAdmin.from("bot_dedup").delete().eq("key", dbDedupKey).then(
        () => {},
        (delErr) => console.error("[PURCHASE] Failed to delete dedup key:", delErr),
      );
    }
    return { error: "Произошла ошибка. Попробуйте позже." };
  }
}
