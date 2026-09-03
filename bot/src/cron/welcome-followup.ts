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

  let sent1 = 0;
  let sent2 = 0;

  const { data: welcomes, error } = await supabaseAdmin
    .from("bot_logs")
    .select("telegram_id, created_at, details")
    .eq("action", "welcome_sent")
    .lte("created_at", cutoff1)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.warn("[WELCOME_FOLLOWUP] Failed to fetch welcomes:", error.code);
    await logBotEvent("cron:welcome_followup", { status: "error", details: error.code });
    return;
  }
  if (!welcomes?.length) return;

  const dedupWelcomes = new Map<string, (typeof welcomes)[number]>();
  for (const w of welcomes) {
    if (typeof w.telegram_id !== "number") continue;
    const k = String(w.telegram_id);
    const prev = dedupWelcomes.get(k);
    if (!prev || new Date(w.created_at).getTime() < new Date(prev.created_at).getTime()) dedupWelcomes.set(k, w);
  }
  const welcomesDeduped = [...dedupWelcomes.values()];

  const telegramIds = welcomesDeduped.map((w) => w.telegram_id as number);

  const { data: followups, error: followupErr } = await supabaseAdmin
    .from("bot_logs")
    .select("telegram_id, action, created_at")
    .in("telegram_id", telegramIds)
    .in("action", ["welcome_followup1", "welcome_followup2"]);

  if (followupErr) {
    console.warn("[WELCOME_FOLLOWUP] Failed to fetch followups:", followupErr.code);
    await logBotEvent("cron:welcome_followup", { status: "error", details: followupErr.code });
    return;
  }

  const followupSet1 = new Set<string>();
  const followupSet2 = new Set<string>();
  for (const f of followups ?? []) {
    if (f.telegram_id == null) continue;
    if (f.action === "welcome_followup1") followupSet1.add(String(f.telegram_id));
    if (f.action === "welcome_followup2") followupSet2.add(String(f.telegram_id));
  }

  const { data: paidRows, error: paidErr } = await supabaseAdmin
    .from("purchase_requests")
    .select("telegram_id")
    .in("telegram_id", telegramIds)
    .eq("status", "paid");

  let paidSet: Set<string> | null = null;
  if (paidErr) {
    console.warn("[WELCOME_FOLLOWUP] Failed to fetch paid:", paidErr.code);
    await logBotEvent("cron:welcome_followup", { status: "error", details: `paid check failed: ${paidErr.code}` });
  } else {
    paidSet = new Set((paidRows ?? []).map((r) => String(r.telegram_id)));
  }

  const { data: clients } = await supabaseAdmin
    .from("clients")
    .select("telegram_id, language")
    .in("telegram_id", telegramIds);

  const langByTid = new Map<string, Language>();
  for (const c of clients ?? []) {
    if (c.telegram_id == null) continue;
    langByTid.set(String(c.telegram_id), c.language === "en" ? "en" : "ru");
  }

  for (const w of welcomesDeduped) {
    const tid = w.telegram_id as number;
    const tidStr = String(tid);
    const welcomeTime = new Date(w.created_at).getTime();
    const age = now - welcomeTime;
    const lang = langByTid.get(tidStr) ?? "ru";

    if (age >= FOLLOWUP1_DELAY_MS && !followupSet1.has(tidStr)) {
      const key = `welcome_followup:${tid}:1`;
      const dedup = await markAsSent(key, DEDUP_TTL_HOURS);
      if (dedup !== "sent") {
        if (dedup === "error") await logBotEvent("cron:welcome_followup", { telegramId: tid, status: "error", details: "dedup 1 failed" });
        continue;
      }
      try {
        await bot.api.sendMessage(tid, t("welcome.followup1", lang));
        const { error: insErr } = await supabaseAdmin.from("bot_logs").insert({ action: "welcome_followup1", telegram_id: tid, status: "ok", details: stringifyDetails(w.details) });
        if (insErr) {
          console.warn("[WELCOME_FOLLOWUP] insert followup1 failed:", insErr.code);
          await deleteDedup(key);
          await logBotEvent("cron:welcome_followup", { telegramId: tid, status: "error", details: insErr.code });
        } else {
          await logBotEvent("cron:welcome_followup", { telegramId: tid, status: "ok", details: "followup1 sent" });
          sent1++;
          followupSet1.add(tidStr);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!isPermanentSendError(err)) await deleteDedup(key);
        await logBotEvent("cron:welcome_followup", { telegramId: tid, status: "error", details: msg });
      }
      continue;
    }

    if (age >= FOLLOWUP2_DELAY_MS && !followupSet2.has(tidStr) && followupSet1.has(tidStr)) {
      if (paidSet === null) {
        await logBotEvent("cron:welcome_followup", { telegramId: tid, status: "error", details: "skip followup2: paid check unavailable" });
        continue;
      }
      if (paidSet.has(tidStr)) continue;
      const key = `welcome_followup:${tid}:2`;
      const dedup = await markAsSent(key, DEDUP_TTL_HOURS);
      if (dedup !== "sent") {
        if (dedup === "error") await logBotEvent("cron:welcome_followup", { telegramId: tid, status: "error", details: "dedup 2 failed" });
        continue;
      }
      try {
        await bot.api.sendMessage(tid, t("welcome.followup2", lang));
        const { error: insErr } = await supabaseAdmin.from("bot_logs").insert({ action: "welcome_followup2", telegram_id: tid, status: "ok", details: stringifyDetails(w.details) });
        if (insErr) {
          console.warn("[WELCOME_FOLLOWUP] insert followup2 failed:", insErr.code);
          await deleteDedup(key);
          await logBotEvent("cron:welcome_followup", { telegramId: tid, status: "error", details: insErr.code });
        } else {
          await logBotEvent("cron:welcome_followup", { telegramId: tid, status: "ok", details: "followup2 sent" });
          sent2++;
          followupSet2.add(tidStr);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!isPermanentSendError(err)) await deleteDedup(key);
        await logBotEvent("cron:welcome_followup", { telegramId: tid, status: "error", details: msg });
      }
    }
  }

  if (sent1 + sent2 > 0) {
    await logBotEvent("cron:welcome_followup", { status: "ok", details: `sent ${sent1} followup1, ${sent2} followup2` });
  }
}
