import type { Bot } from "grammy";
import type { MyContext } from "../bot.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { t, type Language } from "../i18n/index.js";
import {
  getTodayDateStr,
  getTodayDayOfMonth,
  parseTimeRounded,
} from "../lib/workout-utils.js";
import { deleteDedup, markAsSent } from "./dedup.js";
import { logBotEvent } from "./logger.js";
import { DEFAULT_TIMEZONE } from "../lib/constants.js";

const DEDUP_TTL_HOURS = 25;
const MSG_DELAY_MS = 50;
const BATCH_SIZE = 200;

const timeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getClientTimeParts(tz: string): { hour: number; minute: number } {
  let fmt = timeFormatterCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    timeFormatterCache.set(tz, fmt);
  }
  const parts = fmt.formatToParts(new Date());
  let hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  if (hour === 24) hour = 0;
  return { hour, minute };
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
    console.error("[MEASUREMENT_REMINDER] Failed to fetch paused clients:", error.code);
    throw new Error(`Failed to fetch paused clients: ${error.code}`);
  }

  return new Set((data ?? []).map((p) => p.client_id));
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export async function runMeasurementReminder(bot: Bot<MyContext>): Promise<void> {
  const pausedIds = await getPausedClientIds();
  let offset = 0;

  for (;;) {
    const { data: clients, error } = await supabaseAdmin
      .from("clients")
      .select("id, telegram_id, timezone, language, measurement_day, measurement_time, name")
      .eq("status", "active")
      .not("telegram_id", "is", null)
      .not("measurement_day", "is", null)
      .not("measurement_time", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error || !clients?.length) {
      if (error) {
        console.warn("[MEASUREMENT_REMINDER] Failed to fetch clients:", error.code);
      }
      break;
    }

    for (const client of clients) {
      if (pausedIds.has(client.id)) continue;
      if (!client.telegram_id) continue;
      if (client.measurement_day == null || client.measurement_time == null) continue;

      const tz = client.timezone || DEFAULT_TIMEZONE;

      let todayStr: string;
      let dayOfMonth: number;
      try {
        todayStr = getTodayDateStr(tz);
        dayOfMonth = getTodayDayOfMonth(tz);
      } catch {
        console.warn(`[MEASUREMENT_REMINDER] Invalid timezone "${tz}" for client ${client.id}`);
        continue;
      }

      const target = parseTimeRounded(client.measurement_time);
      if (!target) continue;

      let hour: number;
      let minute: number;
      try {
        const time = getClientTimeParts(tz);
        hour = time.hour;
        minute = time.minute;
      } catch {
        console.warn(`[MEASUREMENT_REMINDER] Invalid timezone "${tz}" for client ${client.id}`);
        continue;
      }

      if (hour !== target.hour || minute !== target.minute) continue;

      const [yStr, mStr] = todayStr.split("-");
      const clampDay = daysInMonth(Number(yStr), Number(mStr));
      const scheduledDay = Math.min(Number(client.measurement_day), clampDay);
      if (dayOfMonth !== scheduledDay) continue;

      const dedupKey = `measurement:${client.id}:${todayStr}`;
      const dedupResult = await markAsSent(dedupKey, DEDUP_TTL_HOURS);
      if (dedupResult !== "sent") continue;

      const lang: Language = client.language === "en" ? "en" : "ru";
      const displayName = client.name || t("greeting.default_name", lang);
      const greeting = t("measure.reminder.greeting", lang, { name: displayName });
      const body = t("measure.reminder.body", lang);

      try {
        await bot.api.sendMessage(client.telegram_id, `${greeting}\n\n${body}`);
        await sleep(MSG_DELAY_MS);
      } catch (sendErr) {
        const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
        console.warn(`[MEASUREMENT_REMINDER] Failed to send to ${client.telegram_id}:`, msg);
        await deleteDedup(dedupKey);
        await logBotEvent("cron:measurement_reminder", {
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
}
