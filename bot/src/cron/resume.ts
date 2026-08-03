import type { Bot } from "grammy";
import type { MyContext } from "../bot.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import type { Client } from "../lib/clients.js";
import { t, type Language } from "../i18n/index.js";
import { getTodayDateStr, getTodayWorkout, formatWorkoutMessage, truncateMessage } from "../lib/workout-utils.js";
import { markAsSent } from "./dedup.js";
import { logBotEvent } from "./logger.js";
import { DEFAULT_TIMEZONE } from "../lib/constants.js";
import { resumePlan, suggestStrategy } from "../lib/plan-adjustment.js";
import { daysBetween, sleep } from "../lib/date-utils.js";

const DEDUP_TTL_HOURS = 25;
const MSG_DELAY_MS = 50;
const BATCH_SIZE = 200;

interface PauseRow {
  id: string;
  client_id: string;
  pause_start: string;
  planned_resume_date: string | null;
}

async function fetchActivePausesWithResumeDate(): Promise<PauseRow[]> {
  const { data, error } = await supabaseAdmin
    .from("plan_pauses")
    .select("id, client_id, pause_start, planned_resume_date")
    .eq("status", "active")
    .not("planned_resume_date", "is", null)
    .limit(BATCH_SIZE);

  if (error) {
    console.error("[RESUME] Failed to fetch active pauses:", error.code);
    throw new Error(`Failed to fetch active pauses: ${error.code}`);
  }

  return (data ?? []) as PauseRow[];
}

async function fetchClient(clientId: string): Promise<Client | null> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();

  if (error || !data) return null;
  return data as Client;
}

export async function runAutoResume(bot: Bot<MyContext>): Promise<void> {
  const pauses = await fetchActivePausesWithResumeDate();
  if (pauses.length === 0) return;

  let resumed = 0;

  for (const pause of pauses) {
    try {
      const client = await fetchClient(pause.client_id);

      if (!client) {
        await logBotEvent("cron:auto_resume", {
          clientId: pause.client_id,
          status: "error",
          details: "Client not found",
        });
        continue;
      }

      if (client.status !== "active") {
        await logBotEvent("cron:auto_resume", {
          clientId: pause.client_id,
          status: "info",
          details: `Client status is ${client.status}`,
        });
        continue;
      }

      const tz = client.timezone || DEFAULT_TIMEZONE;
      const clientToday = getTodayDateStr(tz);

      if (!clientToday || !pause.planned_resume_date) continue;
      if (pause.planned_resume_date > clientToday) continue;

      const pauseDurationDays = daysBetween(pause.pause_start, pause.planned_resume_date);
      const strategy = suggestStrategy(pauseDurationDays);
      const result = await resumePlan(pause.client_id, pause.planned_resume_date, strategy);

      if (result.error) {
        await logBotEvent("cron:auto_resume", {
          clientId: pause.client_id,
          status: "error",
          details: result.error,
        });
        continue;
      }

      resumed++;

      if (client.telegram_id) {
        const lang = (client.language || "ru") as Language;

        const dedupKey = `resume:${client.id}:${clientToday}`;
        const dedupResult = await markAsSent(dedupKey, DEDUP_TTL_HOURS);
        if (dedupResult === "sent") {
          try {
            const workout = await getTodayWorkout(client, lang);
            const header = t("resume.resumed_header", lang);
            const msg = workout
              ? `${header}\n\n${await formatWorkoutMessage(workout, lang, client)}`
              : `${header}\n\n${t("resume.no_workout_today", lang)}`;
            const truncated = truncateMessage(msg, t("program.truncation_suffix", lang));
            await bot.api.sendMessage(client.telegram_id, truncated);
            await sleep(MSG_DELAY_MS);
          } catch (sendErr) {
            console.warn(`[RESUME] Failed to notify client ${client.telegram_id}:`, sendErr);
          }
        }
      }

      await logBotEvent("cron:auto_resume", {
        clientId: pause.client_id,
        telegramId: client.telegram_id ?? undefined,
        status: "ok",
        details: `Resumed with strategy: ${strategy}, duration: ${pauseDurationDays}d`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[RESUME] Error processing pause ${pause.id}:`, msg);
      await logBotEvent("cron:auto_resume", {
        clientId: pause.client_id,
        status: "error",
        details: msg,
      });
    }
  }

  if (resumed > 0) {
    await logBotEvent("cron:auto_resume", {
      status: "ok",
      details: `resumed ${resumed} plan(s)`,
    });
  }
}

export async function runResumeReminder(bot: Bot<MyContext>): Promise<void> {
  const pauses = await fetchActivePausesWithResumeDate();
  if (pauses.length === 0) return;

  let sent = 0;

  for (const pause of pauses) {
    try {
      const client = await fetchClient(pause.client_id);
      if (!client || !client.telegram_id) continue;
      if (client.status !== "active") continue;

      const tz = client.timezone || DEFAULT_TIMEZONE;
      const clientToday = getTodayDateStr(tz);

      if (!pause.planned_resume_date) continue;

      const daysUntil = daysBetween(clientToday, pause.planned_resume_date);
      if (daysUntil < 1 || daysUntil > 2) continue;

      const dedupKey = `resume_reminder:${client.id}:${clientToday}:${daysUntil}`;
      const dedupResult = await markAsSent(dedupKey, DEDUP_TTL_HOURS);
      if (dedupResult !== "sent") continue;

      const lang = (client.language || "ru") as Language;
      const message = daysUntil === 2
        ? t("resume.reminder_in_2_days", lang, { name: client.name })
        : t("resume.reminder_tomorrow", lang, { name: client.name });

      await bot.api.sendMessage(client.telegram_id, message);
      sent++;
      await sleep(MSG_DELAY_MS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[RESUME] Failed to send reminder for ${pause.client_id}:`, msg);
      await logBotEvent("cron:resume_reminder", {
        clientId: pause.client_id,
        status: "error",
        details: msg,
      });
    }
  }

  if (sent > 0) {
    await logBotEvent("cron:resume_reminder", {
      status: "ok",
      details: `sent ${sent} reminder(s)`,
    });
  }
}
