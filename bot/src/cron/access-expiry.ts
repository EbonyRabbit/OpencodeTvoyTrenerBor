import type { Bot } from "grammy";
import type { MyContext } from "../bot.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { t, type Language } from "../i18n/index.js";
import { markAsSent, deleteDedup } from "./dedup.js";
import { logBotEvent } from "./logger.js";

const REMIND_DAYS_AHEAD = 5;
// Дедуп по (client, access_end_date): напоминание уходит ровно 1 раз
// на конкретное окно доступа, даже если крон молчал несколько дней.
const DEDUP_TTL_HOURS = 30 * 24;
const MSG_DELAY_MS = 50;
const BATCH_SIZE = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getPausedClientIds(): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from("plan_pauses")
    .select("client_id")
    .eq("status", "active");

  if (error) {
    console.error("[ACCESS_EXPIRY] Failed to fetch paused clients:", error.code);
    throw new Error(`Failed to fetch paused clients: ${error.code}`);
  }

  return new Set((data ?? []).map((p) => p.client_id));
}

/**
 * Окно «истекает через REMIND_DAYS_AHEAD»: [now + 5д, now + 6д) в UTC.
 * access_end_date — TIMESTAMPTZ (пишется как toISOString), поэтому
 * диапазон считается строго в UTC; tz клиента нужен только для текста.
 */
export function accessExpiryWindow(now: Date = new Date()): {
  fromIso: string;
  toIso: string;
} {
  const from = now.getTime() + REMIND_DAYS_AHEAD * 24 * 60 * 60 * 1000;
  return {
    fromIso: new Date(from).toISOString(),
    toIso: new Date(from + 24 * 60 * 60 * 1000).toISOString(),
  };
}

/** «13 августа» / "August 13" для сообщения клиенту (в tz клиента). */
export function formatExpiryDate(
  endIso: string,
  lang: Language,
  timezone?: string | null,
): string {
  try {
    return new Intl.DateTimeFormat(lang === "en" ? "en-US" : "ru-RU", {
      day: "numeric",
      month: "long",
      timeZone: timezone || undefined,
    }).format(new Date(endIso));
  } catch {
    return endIso.slice(0, 10);
  }
}

export function buildAccessExpiryMessage(
  name: string | null,
  accessEndDateIso: string,
  lang: Language,
  timezone?: string | null,
): string {
  const displayName = name || t("greeting.default_name", lang);
  const dateStr = formatExpiryDate(accessEndDateIso, lang, timezone);
  return t("client.access_expiring_soon", lang, { name: displayName, date: dateStr });
}

/**
 * Перманентные ошибки Telegram (403 бот заблокирован, 400 некорректный
 * запрос) не ретраим: дедуп-ключ сохраняем, чтобы не долбить ~96 раз/сутки.
 */
function isPermanentSendError(err: unknown): boolean {
  const code = (err as { error_code?: number })?.error_code;
  return code === 400 || code === 403;
}

export async function runAccessExpiryReminder(bot: Bot<MyContext>): Promise<void> {
  const pausedIds = await getPausedClientIds();
  let sent = 0;
  let offset = 0;
  const { fromIso, toIso } = accessExpiryWindow();

  for (;;) {
    const { data: clients, error } = await supabaseAdmin
      .from("clients")
      .select("id, telegram_id, timezone, language, name, access_end_date")
      .eq("status", "active")
      .not("telegram_id", "is", null)
      .not("access_end_date", "is", null)
      .gte("access_end_date", fromIso)
      .lt("access_end_date", toIso)
      .order("id", { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error || !clients?.length) {
      if (error) console.warn("[ACCESS_EXPIRY] Failed to fetch clients:", error.code);
      break;
    }

    for (const client of clients) {
      if (!client.telegram_id || !client.access_end_date) continue;
      if (pausedIds.has(client.id)) continue;

      try {
        // Дедуп на всё окно доступа: напоминание уходит один раз.
        const dedupKey = `access_expiring:${client.id}:${client.access_end_date}`;
        const dedupResult = await markAsSent(dedupKey, DEDUP_TTL_HOURS);
        if (dedupResult !== "sent") {
          if (dedupResult === "error") {
            await logBotEvent("cron:access_expiry", {
              clientId: client.id,
              telegramId: client.telegram_id,
              status: "error",
              details: "dedup check failed",
            });
          }
          continue;
        }

        const lang: Language = client.language === "en" ? "en" : "ru";
        const message = buildAccessExpiryMessage(
          client.name,
          client.access_end_date,
          lang,
          client.timezone,
        );

        let sentOk = false;
        try {
          await bot.api.sendMessage(client.telegram_id, message);
          sentOk = true;
        } catch (sendErr) {
          const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
          console.warn(`[ACCESS_EXPIRY] Failed to send to ${client.telegram_id}:`, msg);
          if (!isPermanentSendError(sendErr)) {
            await deleteDedup(dedupKey);
          }
          await logBotEvent("cron:access_expiry", {
            clientId: client.id,
            telegramId: client.telegram_id,
            status: "error",
            details: msg,
          });
        }

        if (sentOk) {
          sent++;
          const { error: logError } = await supabaseAdmin
            .from("notification_log")
            .insert({
              client_id: client.id,
              type: "access_expiring",
              status: "sent",
              sent_at: new Date().toISOString(),
              metadata: { access_end_date: client.access_end_date },
            });
          if (logError) {
            console.warn(
              `[ACCESS_EXPIRY] Failed to write notification_log for ${client.id}:`,
              logError.code,
            );
          }
          await sleep(MSG_DELAY_MS);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[ACCESS_EXPIRY] Per-client error for ${client.telegram_id}:`, msg);
        await logBotEvent("cron:access_expiry", {
          clientId: client.id,
          telegramId: client.telegram_id,
          status: "error",
          details: msg,
        });
      }
    }

    if (clients.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  if (sent > 0) {
    await logBotEvent("cron:access_expiry", {
      status: "ok",
      details: `sent ${sent} reminder(s)`,
    });
  }
}
