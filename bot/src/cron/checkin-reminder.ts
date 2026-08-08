import type { Bot } from "grammy";
import type { MyContext } from "../bot.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { getTodayDateStr, getTodayISODay, parseTimeRounded } from "../lib/workout-utils.js";
import { beginCheckin } from "../handlers/checkin.js";
import { markAsSent, deleteDedup } from "./dedup.js";
import { getState, clearState } from "../state/machine.js";
import { logBotEvent } from "./logger.js";
import { DEFAULT_TIMEZONE } from "../lib/constants.js";

const DEDUP_TTL_HOURS = 8 * 24;
const CHECKIN_WINDOW_DAYS = 7;
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
    console.error("[CHECKIN_REMINDER] Failed to fetch paused clients:", error.code);
    throw new Error(`Failed to fetch paused clients: ${error.code}`);
  }

  return new Set((data ?? []).map((p) => p.client_id));
}

export async function runCheckinReminder(bot: Bot<MyContext>): Promise<void> {
  const pausedIds = await getPausedClientIds();
  let sent = 0;
  let offset = 0;

  for (;;) {
    const { data: clients, error } = await supabaseAdmin
      .from("clients")
      .select("id, telegram_id, timezone, language, checkin_day, checkin_time, name, program_id")
      .eq("status", "active")
      .not("telegram_id", "is", null)
      .not("checkin_day", "is", null)
      .not("checkin_time", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error || !clients?.length) {
      if (error) console.warn("[CHECKIN_REMINDER] Failed to fetch clients:", error.code);
      break;
    }

    for (const client of clients) {
      if (!client.telegram_id) continue;
      if (pausedIds.has(client.id)) continue;
      if (client.checkin_day == null || client.checkin_time == null) continue;

      const tz = client.timezone || DEFAULT_TIMEZONE;

      let isoDay: number;
      try {
        isoDay = getTodayISODay(tz);
      } catch {
        console.warn(`[CHECKIN_REMINDER] Invalid timezone "${tz}" for client ${client.id}`);
        continue;
      }

      if (isoDay !== Number(client.checkin_day)) continue;

      const target = parseTimeRounded(client.checkin_time);
      if (!target) continue;

      let hour: number;
      let minute: number;
      try {
        const time = getClientTimeParts(tz);
        hour = time.hour;
        minute = time.minute;
      } catch {
        console.warn(`[CHECKIN_REMINDER] Invalid timezone "${tz}" for client ${client.id}`);
        continue;
      }

      if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        console.warn(`[CHECKIN_REMINDER] Invalid time parts for client ${client.id}: ${hour}:${minute}`);
        continue;
      }
      if (hour !== target.hour || minute !== target.minute) continue;

      try {
        const todayStr = getTodayDateStr(tz);
        const weekStart = getWeekStartDate(todayStr);
        const recentWindowStart = subtractDays(todayStr, CHECKIN_WINDOW_DAYS - 1);
        const dedupKey = `checkin:${client.id}:${weekStart}`;

        const { data: recent, error: recentError } = await supabaseAdmin
          .from("checkins")
          .select("id")
          .eq("client_id", client.id)
          .gte("date", recentWindowStart)
          .limit(1);

        if (recentError) {
          console.warn(`[CHECKIN_REMINDER] Failed to check recent check-ins for ${client.id}:`, recentError.code);
          await logBotEvent("cron:checkin_reminder", {
            clientId: client.id,
            telegramId: client.telegram_id,
            status: "error",
            details: `recent check-in query failed: ${recentError.code}`,
          });
          continue;
        }

        if (recent && recent.length > 0) continue;

        const dedupResult = await markAsSent(dedupKey, DEDUP_TTL_HOURS);
        if (dedupResult !== "sent") continue;

        // Не прерываем активный флоу (чек-ин, тренировка, настройки и т.п.)
        const activeState = await getState(client.telegram_id);
        if (activeState) {
          await deleteDedup(dedupKey);
          continue;
        }

        const ok = await beginCheckin(client.telegram_id, client, (text) =>
          bot.api.sendMessage(client.telegram_id!, text),
        );
        if (!ok) {
          // setState упал, клиенту уже ушло "service unavailable".
          // Чтобы не спамить ошибкой каждые 15 минут при персистентном сбое,
          // снимаем недельный dedup и ставим короткий backoff на 1 час.
          await deleteDedup(dedupKey);
          await markAsSent(dedupKey, 1);
          continue;
        }

        sent++;
        await sleep(MSG_DELAY_MS);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[CHECKIN_REMINDER] Failed to send to ${client.telegram_id}:`, msg);
        const retryKey = `checkin:${client.id}:${getWeekStartDate(getTodayDateStr(tz))}`;
        await deleteDedup(retryKey);
        // setState из beginCheckin мог пройти до того, как send() упал —
        // сбрасываем состояние, чтобы гард activeState не блокировал неделю.
        await clearState(client.telegram_id).catch(() => {});
        await logBotEvent("cron:checkin_reminder", {
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
    await logBotEvent("cron:checkin_reminder", {
      status: "ok",
      details: `sent ${sent} reminder(s)`,
    });
  }
}

function getWeekStartDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - diffToMonday);
  return date.toISOString().slice(0, 10);
}

function subtractDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
