import { InlineKeyboard, type Bot } from "grammy";
import type { MyContext } from "../bot.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { t, type Language } from "../i18n/index.js";
import { getTodayDateStr, getTodayISODay } from "../lib/workout-utils.js";
import { markAsSent } from "./dedup.js";
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

function parseMeasurementTime(timeStr: string): { hour: number; minute: number } | null {
  if (!timeStr) return null;
  const parts = timeStr.split(":");
  if (parts.length < 2) return null;
  const hour = parseInt(parts[0], 10);
  const minute = parseInt(parts[1], 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const roundedMinute = Math.round(minute / 15) * 15;
  if (roundedMinute >= 60) {
    if (hour === 23) return { hour: 23, minute: 45 };
    return { hour: hour + 1, minute: 0 };
  }
  return { hour, minute: roundedMinute };
}

function buildReminderKeyboard(lang: Language): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("measure.reminder.button", lang), "measurements_start");
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

export async function runMeasurementReminder(bot: Bot<MyContext>): Promise<void> {
  const pausedIds = await getPausedClientIds();
  let sent = 0;
  let offset = 0;

  for (;;) {
    const { data: clients, error } = await supabaseAdmin
      .from("clients")
      .select("id, telegram_id, timezone, language, measurement_day, measurement_time, name")
      .eq("status", "active")
      .not("telegram_id", "is", null)
      .not("measurement_day", "is", null)
      .not("measurement_time", "is", null)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error || !clients?.length) {
      if (error) console.warn("[MEASUREMENT_REMINDER] Failed to fetch clients:", error.code);
      break;
    }

    for (const client of clients) {
      if (!client.telegram_id) continue;
      if (pausedIds.has(client.id)) continue;
      if (client.measurement_day == null || client.measurement_time == null) continue;

      const tz = client.timezone || DEFAULT_TIMEZONE;

      let isoDay: number;
      try {
        isoDay = getTodayISODay(tz);
      } catch {
        console.warn(`[MEASUREMENT_REMINDER] Invalid timezone "${tz}" for client ${client.id}`);
        continue;
      }

      if (isoDay < 1 || isoDay > 7) continue;
      if (isoDay !== Number(client.measurement_day)) continue;

      const target = parseMeasurementTime(client.measurement_time);
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

      if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        console.warn(`[MEASUREMENT_REMINDER] Invalid time parts for client ${client.id}: ${hour}:${minute}`);
        continue;
      }
      if (hour !== target.hour || minute !== target.minute) continue;

      const todayStr = getTodayDateStr(tz);

      try {
        const { data: existing } = await supabaseAdmin
          .from("measurements")
          .select("id")
          .eq("client_id", client.id)
          .eq("date", todayStr)
          .maybeSingle();

        if (existing) continue;

        const dedupKey = `measurement:${client.id}:${todayStr}`;

        const dedupResult = await markAsSent(dedupKey, DEDUP_TTL_HOURS);
        if (dedupResult !== "sent") continue;

        const lang: Language = client.language === "en" ? "en" : "ru";
        const displayName = client.name || t("greeting.default_name", lang);
        const greeting = t("measure.reminder.greeting", lang, { name: displayName });
        const body = t("measure.reminder.body", lang);
        const message = `${greeting}\n\n${body}`;
        const keyboard = buildReminderKeyboard(lang);

        await bot.api.sendMessage(client.telegram_id, message, {
          reply_markup: keyboard,
        });

        sent++;
        await sleep(MSG_DELAY_MS);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[MEASUREMENT_REMINDER] Failed to send to ${client.telegram_id}:`, msg);
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

  if (sent > 0) {
    await logBotEvent("cron:measurement_reminder", {
      status: "ok",
      details: `sent ${sent} reminder(s)`,
    });
  }
}
