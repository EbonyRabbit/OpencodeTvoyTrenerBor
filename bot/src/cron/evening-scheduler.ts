import { InlineKeyboard, type Bot } from "grammy";
import type { MyContext } from "../bot.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { findClientByTelegramId } from "../lib/clients.js";
import { t, type Language } from "../i18n/index.js";
import { getTodayWorkout, getTodayDateStr } from "../lib/workout-utils.js";
import { markAsSent } from "./dedup.js";
import { logBotEvent } from "./logger.js";
import { DEFAULT_TIMEZONE } from "../lib/constants.js";

const EVENING_HOUR = 20;
const DEDUP_TTL_HOURS = 25;
const MSG_DELAY_MS = 50;
const BATCH_SIZE = 200;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getClientHour(tz: string): number {
  let fmt = formatterCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    });
    formatterCache.set(tz, fmt);
  }
  return parseInt(fmt.format(new Date()), 10);
}

function buildEveningKeyboard(lang: Language): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("evening.btn_yes", lang), "evening_yes")
    .text(t("evening.btn_no", lang), "evening_no")
    .text(t("evening.btn_postpone", lang), "evening_postpone");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getPausedClientIds(): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from("plan_pauses")
    .select("client_id")
    .eq("status", "active");

  if (error) {
    console.error("[EVENING] Failed to fetch paused clients:", error.code);
    throw new Error(`Failed to fetch paused clients: ${error.code}`);
  }

  return new Set((data ?? []).map((p) => p.client_id));
}

export async function runEveningPoll(bot: Bot<MyContext>): Promise<void> {
  const pausedIds = await getPausedClientIds();
  let sent = 0;
  let offset = 0;

  for (;;) {
    const { data: clients, error } = await supabaseAdmin
      .from("clients")
      .select("id, telegram_id, timezone, language, program_id")
      .eq("status", "active")
      .not("telegram_id", "is", null)
      .not("program_id", "is", null)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error || !clients?.length) {
      if (error) console.warn("[EVENING] Failed to fetch clients:", error.code);
      break;
    }

    for (const client of clients) {
      if (!client.telegram_id) continue;
      if (pausedIds.has(client.id)) continue;

      const tz = client.timezone || DEFAULT_TIMEZONE;
      const hour = getClientHour(tz);

      if (Number.isNaN(hour)) {
        console.warn(`[EVENING] Invalid timezone "${tz}" for client ${client.id}`);
        continue;
      }
      if (hour !== EVENING_HOUR) continue;

      try {
        const fullClient = await findClientByTelegramId(client.telegram_id);
        if (!fullClient) continue;

        const workout = await getTodayWorkout(fullClient);
        if (!workout) continue;

        const todayStr = getTodayDateStr(tz);
        const dedupKey = `evening_poll:${client.id}:${todayStr}`;

        const dedupResult = await markAsSent(dedupKey, DEDUP_TTL_HOURS);
        if (dedupResult !== "sent") continue;

        const lang = (client.language || "ru") as Language;
        const keyboard = buildEveningKeyboard(lang);
        const question = t("evening.poll_question", lang);

        await bot.api.sendMessage(client.telegram_id, question, {
          reply_markup: keyboard,
        });

        sent++;
        await sleep(MSG_DELAY_MS);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[EVENING] Failed to send to ${client.telegram_id}:`, msg);
        await logBotEvent("cron:evening_poll", {
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
    await logBotEvent("cron:evening_poll", {
      status: "ok",
      details: `sent ${sent} poll(s)`,
    });
  }
}
