// 30.9: ежедневная сверка подписок.
// Крон 30.8 гасит только past_due после grace; здесь закрываются два
// состояния, которые без внешнего webhook могут висеть вечно:
//   1) active + cancel_at_period_end + период прошёл → expired;
//   2) active + период прошёл, автосписание не пришло → past_due (grace 3д,
//      дальше его добьёт крон 30.8).
// При заданных PRODAMUS_API_BASE_URL / PRODAMUS_API_TOKEN дополнительно
// сверяется внешний статус подписки и планируется отмена.
import type { Bot } from "grammy";
import cron, { type ScheduledTask } from "node-cron";
import type { MyContext } from "../bot.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { logBotEvent } from "./logger.js";
import { markAsSent, deleteDedup } from "./dedup.js";

const RECONCILE_CRON = "23 6 * * *";
const DEDUP_TTL_HOURS = 30 * 24;

type LiveSub = {
  id: string;
  client_id: string;
  provider_subscription_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

type ExternalSub = {
  status?: string;
  canceled?: boolean;
  cancel_at_period_end?: boolean;
};

function isCancelledExternal(payload: ExternalSub): boolean {
  return (
    payload.canceled === true ||
    payload.cancel_at_period_end === true ||
    payload.status === "cancelled" ||
    payload.status === "canceled"
  );
}

async function checkExternalSub(
  providerId: string,
  baseUrl: string,
  token: string,
): Promise<ExternalSub | null> {
  const url = `${baseUrl}/api/subscription/${encodeURIComponent(providerId)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    throw new Error(`Prodamus subscription API responded ${response.status}`);
  }
  const payload: unknown = await response.json();
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Prodamus subscription API returned unexpected payload");
  }
  return payload as ExternalSub;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
}

async function notifyCancelled(
  bot: Bot<MyContext>,
  sub: LiveSub,
  language: string | null,
): Promise<void> {
  if (!sub.current_period_end) return;
  const dedupKey = `sub_expiring:${sub.id}:${sub.current_period_end}`;
  const dedup = await markAsSent(dedupKey, DEDUP_TTL_HOURS);
  if (dedup !== "sent") return;

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("telegram_id")
    .eq("id", sub.client_id)
    .maybeSingle();
  const telegramId = client?.telegram_id ?? null;
  if (telegramId == null) return;
  const date = formatDate(sub.current_period_end);
  const message =
    language === "en"
      ? `Subscription cancellation scheduled. Access stays active until ${date}.`
      : `Отмена подписки запланирована. Доступ сохранится до ${date}.`;
  try {
    await bot.api.sendMessage(telegramId, message);
    await supabaseAdmin.from("notification_log").insert({
      client_id: sub.client_id,
      type: "subscription_expiring",
      status: "sent",
      sent_at: new Date().toISOString(),
      metadata: { subscription_id: sub.id, period_end: sub.current_period_end },
    });
  } catch (err) {
    await deleteDedup(dedupKey);
    console.warn(
      `[SUB_RECONCILE] Failed to notify client ${telegramId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

export async function runSubscriptionReconcile(
  bot: Bot<MyContext>,
): Promise<string> {
  const nowIso = new Date().toISOString();

  const { data: completed, error: completedError } = await supabaseAdmin
    .from("subscriptions")
    .update({ status: "expired" })
    .in("status", ["active", "past_due"])
    .eq("cancel_at_period_end", true)
    .lt("current_period_end", nowIso)
    .select("id");
  if (completedError) {
    throw new Error(`Completed-cancel reconcile failed: ${completedError.message}`);
  }

  const { data: missed, error: missedError } = await supabaseAdmin
    .from("subscriptions")
    .update({ status: "past_due" })
    .eq("status", "active")
    .eq("cancel_at_period_end", false)
    .lt("current_period_end", nowIso)
    .select("id");
  if (missedError) {
    throw new Error(`Missed-renewal reconcile failed: ${missedError.message}`);
  }

  let externalChecked = 0;
  let externalCancelled = 0;
  const baseUrl = process.env.PRODAMUS_API_BASE_URL?.trim();
  const token = process.env.PRODAMUS_API_TOKEN?.trim();
  if (baseUrl?.startsWith("https://") && token) {
    const { data: liveSubs, error: liveError } = await supabaseAdmin
      .from("subscriptions")
      .select("id, client_id, provider_subscription_id, current_period_end, cancel_at_period_end")
      .in("status", ["active", "past_due"])
      .not("provider_subscription_id", "is", null);
    if (liveError) {
      throw new Error(`Live subs lookup failed: ${liveError.message}`);
    }
    for (const row of (liveSubs ?? []) as LiveSub[]) {
      if (!row.provider_subscription_id || row.cancel_at_period_end) continue;
      externalChecked += 1;
      try {
        const external = await checkExternalSub(
          row.provider_subscription_id,
          baseUrl,
          token,
        );
        if (external && isCancelledExternal(external)) {
          const periodPassed =
            row.current_period_end !== null &&
            new Date(row.current_period_end).getTime() <= Date.now();
          const { error } = await supabaseAdmin
            .from("subscriptions")
            .update({
              ...(periodPassed ? { status: "expired" } : {}),
              cancel_at_period_end: true,
              next_payment_at: null,
            })
            .eq("id", row.id)
            .eq("cancel_at_period_end", false);
          if (!error) {
            externalCancelled += 1;
            const { data: client } = await supabaseAdmin
              .from("clients")
              .select("language")
              .eq("id", row.client_id)
              .maybeSingle();
            await notifyCancelled(bot, row, client?.language ?? null);
          }
        }
      } catch (err) {
        console.warn(
          `[SUB_RECONCILE] External check failed for ${row.id}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  const summary = `expired=${completed?.length ?? 0} past_due=${missed?.length ?? 0} external_checked=${externalChecked} external_cancelled=${externalCancelled}`;
  await logBotEvent("cron:subscription_reconcile", { status: "ok", details: summary });
  return summary;
}

let task: ScheduledTask | null = null;
let isRunning = false;

export function startSubscriptionReconcile(bot: Bot<MyContext>): void {
  if (task) return;
  task = cron.schedule(RECONCILE_CRON, () => {
    if (isRunning) return;
    isRunning = true;
    void runSubscriptionReconcile(bot)
      .catch((err: unknown) => {
        console.error("[SUB_RECONCILE] Cron error:", err);
      })
      .finally(() => {
        isRunning = false;
      });
  });
}

export function stopSubscriptionReconcile(): void {
  task?.stop();
  task = null;
}
