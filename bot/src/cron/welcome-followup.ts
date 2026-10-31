import type { Bot } from "grammy";
import type { MyContext } from "../bot.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { t, type Language } from "../i18n/index.js";
import { markAsSent, deleteDedup } from "./dedup.js";
import { logBotEvent } from "./logger.js";

const DEDUP_TTL_HOURS = 7 * 24;
const BATCH_SIZE = 200;
const FOLLOWUP1_DELAY_MS = 24 * 60 * 60 * 1000;
const FOLLOWUP2_DELAY_MS = 72 * 60 * 60 * 1000;
const ID_CHUNK_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function isPermanentSendError(err: unknown): boolean {
  const code = (err as { error_code?: number })?.error_code;
  return code === 400 || code === 403;
}

function stringifyDetails(v: unknown): string {
  if (typeof v === "string") return v.slice(0, 64);
  if (v == null) return "";
  try {
    return JSON.stringify(v).slice(0, 64);
  } catch {
    return String(v).slice(0, 64);
  }
}

export async function runWelcomeFollowup(bot: Bot<MyContext>): Promise<void> {
  const now = Date.now();
  const cutoff1 = new Date(now - FOLLOWUP1_DELAY_MS).toISOString();
  const windowStart = new Date(
    now - DEDUP_TTL_HOURS * 60 * 60 * 1000,
  ).toISOString();

  let sent1 = 0;
  let sent2 = 0;

  type WelcomeRow = {
    id: string;
    telegram_id: number | null;
    created_at: string;
    details: unknown;
  };

  const welcomes: WelcomeRow[] = [];
  let lastCreatedAt: string | null = null;
  let lastId: string | null = null;

  for (;;) {
    let query = supabaseAdmin
      .from("bot_logs")
      .select("id, telegram_id, created_at, details")
      .eq("action", "welcome_sent")
      .gte("created_at", windowStart)
      .lte("created_at", cutoff1)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(BATCH_SIZE);
    if (lastCreatedAt && lastId) {
      query = query.or(
        `created_at.gt.${lastCreatedAt},and(created_at.eq.${lastCreatedAt},id.gt.${lastId})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      console.warn("[WELCOME_FOLLOWUP] Failed to fetch welcomes:", error.code);
      await logBotEvent("cron:welcome_followup", {
        status: "error",
        details: error.code,
      });
      return;
    }
    if (!data?.length) break;

    welcomes.push(...(data as WelcomeRow[]));
    if (data.length < BATCH_SIZE) break;

    const last = data[data.length - 1] as WelcomeRow;
    lastCreatedAt = last.created_at;
    lastId = last.id;
  }

  if (!welcomes.length) return;

  const dedupWelcomes = new Map<string, WelcomeRow>();
  for (const w of welcomes) {
    if (typeof w.telegram_id !== "number") continue;
    const ts = new Date(w.created_at).getTime();
    if (!Number.isFinite(ts)) continue;
    const k = String(w.telegram_id);
    const prev = dedupWelcomes.get(k);
    if (!prev || ts > new Date(prev.created_at).getTime())
      dedupWelcomes.set(k, w);
  }
  const welcomesDeduped = [...dedupWelcomes.values()];
  if (!welcomesDeduped.length) return;

  const telegramIds = [
    ...new Set(welcomesDeduped.map((w) => w.telegram_id as number)),
  ];
  if (!telegramIds.length) return;

  const followups: Array<{
    telegram_id: number | null;
    action: string;
    created_at: string;
    details: unknown;
  }> = [];
  for (const ids of chunk(telegramIds, ID_CHUNK_SIZE)) {
    const { data, error: followupErr } = await supabaseAdmin
      .from("bot_logs")
      .select("telegram_id, action, created_at, details")
      .in("telegram_id", ids)
      .in("action", ["welcome_followup1", "welcome_followup2"])
      .gte("created_at", windowStart);
    if (followupErr) {
      console.warn(
        "[WELCOME_FOLLOWUP] Failed to fetch followups:",
        followupErr.code,
      );
      await logBotEvent("cron:welcome_followup", {
        status: "error",
        details: followupErr.code,
      });
      return;
    }
    followups.push(...(data ?? []));
  }

  const followupSet1 = new Set<string>();
  const followupSet2 = new Set<string>();
  for (const f of followups) {
    if (f.telegram_id == null) continue;
    const ff =
      String((f as { details?: unknown }).details ?? "").toLowerCase() ===
      "guide_calories"
        ? "guide"
        : "base";
    // legacy rows without details count for both funnels to avoid double-send
    if (f.action === "welcome_followup1") {
      followupSet1.add(`${String(f.telegram_id)}:${ff}`);
      if (!(f as { details?: unknown }).details)
        followupSet1.add(`${String(f.telegram_id)}:guide`);
    }
    if (f.action === "welcome_followup2") {
      followupSet2.add(`${String(f.telegram_id)}:${ff}`);
      if (!(f as { details?: unknown }).details)
        followupSet2.add(`${String(f.telegram_id)}:guide`);
    }
  }

  let paidSet: Set<string> | null = null;
  for (const ids of chunk(telegramIds, ID_CHUNK_SIZE)) {
    const { data: paidRows, error: paidErr } = await supabaseAdmin
      .from("purchase_requests")
      .select("telegram_id")
      .in("telegram_id", ids)
      .eq("status", "paid");
    if (paidErr) {
      console.warn("[WELCOME_FOLLOWUP] Failed to fetch paid:", paidErr.code);
      await logBotEvent("cron:welcome_followup", {
        status: "error",
        details: `paid check failed: ${paidErr.code}`,
      });
      paidSet = null;
      break;
    }
    if (!paidSet) paidSet = new Set<string>();
    for (const r of paidRows ?? []) paidSet.add(String(r.telegram_id));
  }

  const langByTid = new Map<string, Language>();
  for (const ids of chunk(telegramIds, ID_CHUNK_SIZE)) {
    const { data: clients } = await supabaseAdmin
      .from("clients")
      .select("telegram_id, language")
      .in("telegram_id", ids);
    for (const c of clients ?? []) {
      if (c.telegram_id == null) continue;
      langByTid.set(String(c.telegram_id), c.language === "en" ? "en" : "ru");
    }
  }

  for (const w of welcomesDeduped) {
    const tid = w.telegram_id as number;
    const tidStr = String(tid);
    const welcomeTime = new Date(w.created_at).getTime();
    const age = now - welcomeTime;
    const lang = langByTid.get(tidStr) ?? "ru";
    const isGuide =
      String(w.details ?? "").toLowerCase() === "guide_calories";
    const funnel = isGuide ? "guide" : "base";
    const fkey1 = `${tidStr}:${funnel}`;
    const msgKey1 = isGuide ? "welcome.guide_followup1" : "welcome.followup1";
    const msgKey2 = isGuide ? "welcome.guide_followup2" : "welcome.followup2";

    if (age >= FOLLOWUP1_DELAY_MS && !followupSet1.has(fkey1)) {
      const key = `welcome_followup:${funnel}:${tid}:1`;
      const dedup = await markAsSent(key, DEDUP_TTL_HOURS);
      if (dedup !== "sent") {
        if (dedup === "error")
          await logBotEvent("cron:welcome_followup", {
            telegramId: tid,
            status: "error",
            details: "dedup 1 failed",
          });
        continue;
      }
      try {
        await bot.api.sendMessage(tid, t(msgKey1, lang));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!isPermanentSendError(err)) await deleteDedup(key);
        await logBotEvent("cron:welcome_followup", {
          telegramId: tid,
          status: "error",
          details: msg,
        });
        continue;
      }
      try {
        const { error: insErr } = await supabaseAdmin.from("bot_logs").insert({
          action: "welcome_followup1",
          telegram_id: tid,
          status: "ok",
          details: stringifyDetails(w.details),
        });
        if (insErr) {
          console.warn(
            "[WELCOME_FOLLOWUP] insert followup1 failed:",
            insErr.code,
          );
          // Сообщение уже ушло. Удалять dedup нельзя: следующий запуск
          // отправит дубль. Ошибка касается только записи истории.
          await logBotEvent("cron:welcome_followup", {
            telegramId: tid,
            status: "error",
            details: insErr.code,
          });
        } else {
          await logBotEvent("cron:welcome_followup", {
            telegramId: tid,
            status: "ok",
            details: "followup1 sent",
          });
          sent1++;
          followupSet1.add(fkey1);
        }
      } catch (err) {
        console.warn(
          "[WELCOME_FOLLOWUP] insert followup1 threw:",
          err instanceof Error ? err.message : err,
        );
      }
      continue;
    }

    if (
      age >= FOLLOWUP2_DELAY_MS &&
      !followupSet2.has(fkey1) &&
      followupSet1.has(fkey1)
    ) {
      if (paidSet === null) {
        await logBotEvent("cron:welcome_followup", {
          telegramId: tid,
          status: "error",
          details: "skip followup2: paid check unavailable",
        });
        continue;
      }
      if (paidSet.has(tidStr)) continue;
      const key = `welcome_followup:${funnel}:${tid}:2`;
      const dedup = await markAsSent(key, DEDUP_TTL_HOURS);
      if (dedup !== "sent") {
        if (dedup === "error")
          await logBotEvent("cron:welcome_followup", {
            telegramId: tid,
            status: "error",
            details: "dedup 2 failed",
          });
        continue;
      }
      try {
        await bot.api.sendMessage(tid, t(msgKey2, lang));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!isPermanentSendError(err)) await deleteDedup(key);
        await logBotEvent("cron:welcome_followup", {
          telegramId: tid,
          status: "error",
          details: msg,
        });
        continue;
      }
      try {
        const { error: insErr } = await supabaseAdmin.from("bot_logs").insert({
          action: "welcome_followup2",
          telegram_id: tid,
          status: "ok",
          details: stringifyDetails(w.details),
        });
        if (insErr) {
          console.warn(
            "[WELCOME_FOLLOWUP] insert followup2 failed:",
            insErr.code,
          );
          // Сообщение уже ушло: сохраняем dedup, чтобы не отправить дубль.
          await logBotEvent("cron:welcome_followup", {
            telegramId: tid,
            status: "error",
            details: insErr.code,
          });
        } else {
          await logBotEvent("cron:welcome_followup", {
            telegramId: tid,
            status: "ok",
            details: "followup2 sent",
          });
          sent2++;
          followupSet2.add(fkey1);
        }
      } catch (err) {
        console.warn(
          "[WELCOME_FOLLOWUP] insert followup2 threw:",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  if (sent1 + sent2 > 0) {
    await logBotEvent("cron:welcome_followup", {
      status: "ok",
      details: `sent ${sent1} followup1, ${sent2} followup2`,
    });
  }
}
