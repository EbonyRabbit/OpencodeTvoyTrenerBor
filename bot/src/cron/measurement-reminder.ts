import { InlineKeyboard, type Bot } from "grammy";
import type { MyContext } from "../bot.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { t, type Language } from "../i18n/index.js";
import {
  getTodayDateStr,
  getTodayDayOfMonth,
  parseTimeRounded,
} from "../lib/workout-utils.js";
import { markAsSent, deleteDedup, isSent } from "./dedup.js";
import { logBotEvent } from "./logger.js";
import { DEFAULT_TIMEZONE } from "../lib/constants.js";

const DEDUP_TTL_HOURS = 25;
export const DEFERRED_MONTH_TTL_HOURS = 32 * 24;
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

function buildReminderKeyboard(lang: Language): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("measure.reminder.button", lang), "measurements_start")
    .text(t("measure.defer_button", lang), "measurements_defer");
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

function monthPrefix(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export async function runMeasurementReminder(bot: Bot<MyContext>): Promise<void> {
  const pausedIds = await getPausedClientIds();
  let sent = 0;
  let offset = 0;

  for (;;) {
    const { data: clients, error } = await supabaseAdmin
      .from("clients")
      .select(
        "id, telegram_id, timezone, language, measurement_day, measurement_time, measurement_defer_date, name",
      )
      .eq("status", "active")
      .not("telegram_id", "is", null)
      .not("measurement_day", "is", null)
      .not("measurement_time", "is", null)
      .order("id", { ascending: true })
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

      if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        console.warn(`[MEASUREMENT_REMINDER] Invalid time parts for client ${client.id}: ${hour}:${minute}`);
        continue;
      }
      if (hour !== target.hour || minute !== target.minute) continue;

      try {
        // Уже обмеривались в текущем месяце -> не напоминаем.
        // Верхняя граница = начало следующего месяца: будущая запись в этом же
        // месяце не должна гасить напоминание за текущий месяц.
        const month = monthPrefix(todayStr);
        const [ym, mm] = month.split("-").map(Number);
        const nextMonthStart =
          mm === 12
            ? `${ym + 1}-01-01`
            : `${ym}-${String(mm + 1).padStart(2, "0")}-01`;
        const { data: existingMonth, error: existingMonthError } = await supabaseAdmin
          .from("measurements")
          .select("id")
          .eq("client_id", client.id)
          .gte("date", `${month}-01`)
          .lt("date", nextMonthStart)
          .limit(1);

        if (existingMonthError) {
          console.warn(`[MEASUREMENT_REMINDER] Failed to check measurements for ${client.id}:`, existingMonthError.code);
          await logBotEvent("cron:measurement_reminder", {
            clientId: client.id,
            telegramId: client.telegram_id,
            status: "error",
            details: `measurement query failed: ${existingMonthError.code}`,
          });
          continue;
        }

        if (existingMonth && existingMonth.length > 0) {
          // если было отложено и дата устарела — чистим
          if (client.measurement_defer_date && client.measurement_defer_date < todayStr) {
            await clearDeferred(client.id);
          }
          continue;
        }

        // День срабатывания: выбранный defer-число ИЛИ штатный measurement_day
        const deferredToday =
          client.measurement_defer_date && client.measurement_defer_date === todayStr;
        const [yStr, mStr] = todayStr.split("-");
        const clampDay = daysInMonth(Number(yStr), Number(mStr));
        const scheduledDay = Math.min(Number(client.measurement_day), clampDay);
        const isScheduledDay = dayOfMonth === scheduledDay;

        if (!deferredToday && !isScheduledDay) continue;

        // Устаревший defer (> дня переноса) больше не используется.
        // Снимаем и месячную метку переноса: если крон был недоступен в день переноса,
        // штатное число в этом месяце должно самовосстановиться.
        // NB: здесь уже гарантирован isScheduledDay === true (stale defer => !deferredToday).
        if (client.measurement_defer_date && client.measurement_defer_date < todayStr) {
          await clearDeferred(client.id);
          await deleteDedup(`measurement:deferred:${client.id}:${monthPrefix(client.measurement_defer_date)}`);
        }

        // Если в этом месяце кто-то уже переносил замеры — штатное число не напоминаем.
        // При ошибке проверки действуем fail-closed (пропускаем): риск пропуска
        // одного напоминания меньше, чем риск дубля.
        if (isScheduledDay && !deferredToday) {
          const monthDeferred = await isSent(`measurement:deferred:${client.id}:${month}`);
          if (monthDeferred === true) continue;
          if (monthDeferred === "error") {
            console.warn(`[MEASUREMENT_REMINDER] Failed to check defer month for ${client.id}`);
            await logBotEvent("cron:measurement_reminder", {
              clientId: client.id,
              telegramId: client.telegram_id,
              status: "error",
              details: "defer month dedup check failed",
            });
            continue;
          }
        }

        const dedupKey = `measurement:${client.id}:${todayStr}`;

        const dedupResult = await markAsSent(dedupKey, DEDUP_TTL_HOURS);
        if (dedupResult !== "sent") continue;

        const lang: Language = client.language === "en" ? "en" : "ru";
        const displayName = client.name || t("greeting.default_name", lang);
        const greeting = t("measure.reminder.greeting", lang, { name: displayName });
        const body = t("measure.reminder.body", lang);
        const message = `${greeting}\n\n${body}`;
        const keyboard = buildReminderKeyboard(lang);

        // Отправка сама по себе: только если она БРОСИЛА исключение — снимаем
        // day-ключ, чтобы повторный тик мог напомнить (транзиентный сбой сети).
        // 15-минутный крон совпадает с целевой минутой раз в сутки, поэтому при
        // транзиентном сбое напоминание фактически уходит следующим днём в то же время.
        let sentOk = false;
        try {
          await bot.api.sendMessage(client.telegram_id, message, {
            reply_markup: keyboard,
          });
          sentOk = true;
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

        if (sentOk) {
          sent++;
          if (deferredToday) {
            // defer «заменяет» штатное число: на весь месяц помечаем, что напомнили.
            // Ошибки здесь НЕ снимают day-ключ (дубликат уже сходил);
            // дубликат отправки не страшен — метка просто повторится в следующих тиках.
            try {
              await markAsSent(`measurement:deferred:${client.id}:${month}`, DEFERRED_MONTH_TTL_HOURS);
              await clearDeferred(client.id);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.warn(`[MEASUREMENT_REMINDER] Defer bookkeeping failed for ${client.id}:`, msg);
            }
          }
          await sleep(MSG_DELAY_MS);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[MEASUREMENT_REMINDER] Per-client error for ${client.telegram_id}:`, msg);
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

export async function clearDeferred(clientId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("clients")
    .update({ measurement_defer_date: null, updated_at: new Date().toISOString() })
    .eq("id", clientId);
  if (error) {
    console.error(`[MEASUREMENT_REMINDER] Failed to clear defer for ${clientId}:`, error.code);
  }
}

export function computeNextDayOfMonthDate(tz: string, day: number): string {
  const todayStr = getTodayDateStr(tz);
  const [yStr, mStr, dStr] = todayStr.split("-");
  const year = Number(yStr);
  const month = Number(mStr);
  const todayDay = Number(dStr);

  // The defer callback is only available after today's reminder was sent,
  // so a candidate equal to today is already past. In short months the
  // clamped value can also land on today (e.g. Feb 28 → day 31 clamps to 28),
  // which must advance to next month as well.
  if (day > todayDay) {
    const clamped = Math.min(day, daysInMonth(year, month));
    if (clamped > todayDay) {
      return `${yStr}-${mStr}-${String(clamped).padStart(2, "0")}`;
    }
  }

  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const clamped = Math.min(day, daysInMonth(nextYear, nextMonth));
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
