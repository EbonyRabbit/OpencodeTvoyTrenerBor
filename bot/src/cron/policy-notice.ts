import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import type { MyContext } from "../bot.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { t, type Language } from "../i18n/index.js";
import {
  PRIVACY_POLICY_VERSION,
  buildPrivacyUrl,
} from "../handlers/consent.js";
import { deleteDedup, markAsSent } from "./dedup.js";
import { logBotEvent } from "./logger.js";

const NOTICE_TTL_HOURS = 365 * 24;
const NOTICE_BATCH_SIZE = 200;

type ClientRow = {
  id: string;
  telegram_id: number | null;
  language: string | null;
  client_consent_version: string | null;
};

function isPermanentSendError(err: unknown): boolean {
  const code = (err as { error_code?: number })?.error_code;
  const description = (err as { description?: string })?.description ?? "";
  const message = err instanceof Error ? err.message : description;

  if (code === 403) return true;
  return (
    code === 400 &&
    /chat not found|user not found|peer_id_invalid|bot is not a member/i.test(message)
  );
}

export function buildPolicyNotice(lang: Language): string {
  return t("client.policy_notice", lang, { privacyUrl: buildPrivacyUrl() });
}

async function notifyClient(
  bot: Bot<MyContext>,
  client: ClientRow,
): Promise<void> {
  if (client.telegram_id == null) return;
  if (client.client_consent_version === PRIVACY_POLICY_VERSION) return;

  const key = `policy_notice:${PRIVACY_POLICY_VERSION}:${client.id}`;
  const dedup = await markAsSent(key, NOTICE_TTL_HOURS);
  if (dedup !== "sent") {
    if (dedup === "error") {
      await logBotEvent("cron:policy_notice", {
        telegramId: client.telegram_id,
        status: "error",
        details: "dedup failed",
      });
    }
    return;
  }

  const lang: Language = client.language === "en" ? "en" : "ru";
  const keyboard = new InlineKeyboard().text(
    t("client.consent_accept", lang),
    "consent_accept",
  );

  try {
    await bot.api.sendMessage(client.telegram_id, buildPolicyNotice(lang), {
      reply_markup: keyboard,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!isPermanentSendError(err)) await deleteDedup(key);
    await logBotEvent("cron:policy_notice", {
      telegramId: client.telegram_id,
      status: "error",
      details: message,
    });
    return;
  }

  const { error: logError } = await supabaseAdmin.from("bot_logs").insert({
    action: "policy_notice",
    telegram_id: client.telegram_id,
    client_id: client.id,
    status: "ok",
    details: PRIVACY_POLICY_VERSION,
  });
  if (logError) {
    console.warn("[POLICY_NOTICE] Log insert failed:", logError.code);
  }
}

export async function runPolicyNotice(bot: Bot<MyContext>): Promise<void> {
  let lastId: string | null = null;

  for (;;) {
    let query = supabaseAdmin
      .from("clients")
      .select("id, telegram_id, language, client_consent_version")
      .eq("status", "active")
      .not("telegram_id", "is", null)
      .order("id", { ascending: true })
      .limit(NOTICE_BATCH_SIZE);
    if (lastId) query = query.gt("id", lastId);

    const { data, error } = await query;
    if (error) {
      console.warn("[POLICY_NOTICE] Client lookup failed:", error.code);
      await logBotEvent("cron:policy_notice", {
        status: "error",
        details: error.code,
      });
      return;
    }

    const batch = (data ?? []) as unknown as ClientRow[];
    for (const client of batch) {
      await notifyClient(bot, client);
    }

    if (batch.length < NOTICE_BATCH_SIZE) break;
    lastId = batch[batch.length - 1]?.id ?? null;
    if (!lastId) break;
  }
}
