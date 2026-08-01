import { InlineKeyboard, type Bot } from "grammy";
import type { MyContext } from "../bot.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { findClientByTelegramId } from "../lib/clients.js";
import { t, type Language } from "../i18n/index.js";
import {
  getTodayWorkout,
  getTodayDateStr,
  formatWorkoutMessage,
  truncateMessage,
} from "../lib/workout-utils.js";
import { markAsSent } from "./dedup.js";
import { logBotEvent } from "./logger.js";
import { DEFAULT_TIMEZONE } from "../lib/constants.js";

const DEDUP_TTL_HOURS = 25;
const MSG_DELAY_MS = 50;
const BATCH_SIZE = 200;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getClientTimeParts(tz: string): { hour: number; minute: number } {
  let fmt = formatterCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    formatterCache.set(tz, fmt);
  }
  const parts = fmt.formatToParts(new Date());
  let hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  if (hour === 24) hour = 0;
  return { hour, minute };
}

function parseMorningTime(timeStr: string): { hour: number; minute: number } | null {
  if (!timeStr) return null;
  const parts = timeStr.split(":");
  if (parts.length < 2) return null;
  const hour = parseInt(parts[0], 10);
  const minute = parseInt(parts[1], 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const roundedMinute = Math.round(minute / 15) * 15;
  const adjustedHour = roundedMinute >= 60 ? (hour + 1) % 24 : hour;
  const adjustedMinute = roundedMinute >= 60 ? 0 : roundedMinute;
  return { hour: adjustedHour, minute: adjustedMinute };
}

function buildMorningKeyboard(lang: Language): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("workout.open_button", lang), "today_open")
    .text(t("workout.skip_button", lang), "skip_workout");
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
    console.error("[MORNING] Failed to fetch paused clients:", error.code);
    throw new Error(`Failed to fetch paused clients: ${error.code}`);
  }

  return new Set((data ?? []).map((p) => p.client_id));
}

export async function runMorningNotification(bot: Bot<MyContext>): Promise<void> {
  const pausedIds = await getPausedClientIds();
  let sent = 0;
  let offset = 0;

  for (;;) {
    const { data: clients, error } = await supabaseAdmin
      .from("clients")
      .select("id, telegram_id, timezone, language, program_id, morning_time, name")
      .eq("status", "active")
      .not("telegram_id", "is", null)
      .not("program_id", "is", null)
      .not("morning_time", "is", null)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error || !clients?.length) {
      if (error) console.warn("[MORNING] Failed to fetch clients:", error.code);
      break;
    }

    for (const client of clients) {
      if (!client.telegram_id) continue;
      if (pausedIds.has(client.id)) continue;
      if (!client.morning_time) continue;

      const tz = client.timezone || DEFAULT_TIMEZONE;
      const target = parseMorningTime(client.morning_time);
      if (!target) continue;

      let hour: number;
      let minute: number;
      try {
        const time = getClientTimeParts(tz);
        hour = time.hour;
        minute = time.minute;
      } catch {
        console.warn(`[MORNING] Invalid timezone "${tz}" for client ${client.id}`);
        continue;
      }

      if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        console.warn(`[MORNING] Invalid time parts for client ${client.id}: ${hour}:${minute}`);
        continue;
      }
      if (hour !== target.hour || minute !== target.minute) continue;

      try {
        const fullClient = await findClientByTelegramId(client.telegram_id);
        if (!fullClient) continue;

        const lang = (client.language || "ru") as Language;
        const workout = await getTodayWorkout(fullClient, lang);
        if (!workout) continue;

        const todayStr = getTodayDateStr(tz);
        const dedupKey = `morning:${client.id}:${todayStr}`;

        const dedupResult = await markAsSent(dedupKey, DEDUP_TTL_HOURS);
        if (dedupResult !== "sent") continue;

        const greeting = t("morning.greeting", lang, { name: client.name });
        const header = t("morning.header", lang);
        const workoutText = formatWorkoutMessage(workout, lang);
        const message = `${greeting}\n\n${header}\n\n${workoutText}`;
        const truncated = truncateMessage(message, t("program.truncation_suffix", lang));
        const keyboard = buildMorningKeyboard(lang);

        await bot.api.sendMessage(client.telegram_id, truncated, {
          reply_markup: keyboard,
        });

        sent++;
        await sleep(MSG_DELAY_MS);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[MORNING] Failed to send to ${client.telegram_id}:`, msg);
        await logBotEvent("cron:morning_notification", {
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
    await logBotEvent("cron:morning_notification", {
      status: "ok",
      details: `sent ${sent} notification(s)`,
    });
  }
}
