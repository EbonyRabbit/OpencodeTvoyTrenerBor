// Webhook Продамуса (Фаза 21.7).
//
// Продамус POST'ит application/x-www-form-urlencoded (или multipart) c подписью
// в заголовке "Sign". До проверки подписи запрос не аутентифицирован, поэтому:
//   1) секрет читаем до любых действий, при его отсутствии - fail closed;
//   2) подпись проверяем через verifyProdamusSignature (тотальный парсер,
//      HMAC-SHA256, timingSafeEqual);
//   3) логируем минимум данных и никогда - секрет или неподписанный body.
//
// Диспетчеризация по payment_status:
//   success                      → активация покупки (21.6), идемпотентно
//   order_canceled / order_denied→ заявка → cancelled + уведомление тренеру
//   всё остальное (fail, …)     → ack 200 без действий
import {
  parseProdamusOrder,
  verifyProdamusSignature,
  type ProdamusFormEntries,
} from "@/lib/prodamus";
import { activatePurchaseByOrder } from "@/lib/activate-purchase";
import { sendTelegramMessage } from "@/lib/telegram";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendCoachAlertOnce } from "@/lib/coach-alert";
import { UUID_REGEX } from "@/lib/validation";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CANCEL_STATUSES = new Set(["order_canceled", "order_denied"]);

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function formatAmount(amount: number | null): string {
  if (amount === null || !Number.isFinite(amount)) return "-";
  return `${amount.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
}

type CancelledRequestRow = {
  name: string;
  contact: string;
  telegram_id: number | null;
  amount: number | null;
  sub_type: string;
};

function buildCancelCoachMessage(row: CancelledRequestRow): string {
  const kind =
    row.sub_type === "individ" ? "Индивидуальное ведение" : "Программа";
  return (
    `❌ Заявка отменена\n\n` +
    `Клиент: ${row.name}\n` +
    `Контакт: ${row.contact}` +
    (row.telegram_id !== null ? `\nTG ID: ${row.telegram_id}` : "") +
    `\nТип: ${kind}\n` +
    `Сумма: ${formatAmount(row.amount)}`
  );
}

async function notifyCoachCancellation(
  row: CancelledRequestRow,
): Promise<void> {
  const coachChatId = process.env.COACH_CHAT_ID;
  if (!coachChatId) {
    console.error(
      "[PRODAMUS WEBHOOK] COACH_CHAT_ID is not set; cancel notification skipped",
    );
    return;
  }
  try {
    const sent = await sendTelegramMessage(
      coachChatId,
      buildCancelCoachMessage(row),
    );
    if (!sent) {
      console.error("[PRODAMUS WEBHOOK] Coach cancellation notify failed");
    }
  } catch (err) {
    console.error(
      "[PRODAMUS WEBHOOK] Coach cancellation notify error:",
      err instanceof Error ? err.message : err,
    );
  }
}


async function notifyCoachActivationFailure(
  orderId: string,
  reason: string,
  amount: number | null,
): Promise<boolean> {
  const text =
    `⚠️ Оплата получена, но активация требует внимания\n\n` +
    `Заказ: ${orderId}\n` +
    `Сумма: ${formatAmount(amount)}\n` +
    `Причина: ${reason}`;
  const reasonHash = createHash("sha256")
    .update(reason)
    .digest("hex")
    .slice(0, 12);
  const delivered = await sendCoachAlertOnce(
    `activation_alert:${orderId}:${reasonHash}`,
    text,
  );
  if (!delivered) {
    await persistActivationAlert(orderId, reason);
  }
  return delivered;
}

async function persistActivationAlert(
  orderId: string,
  reason: string,
): Promise<boolean> {
  const { error } = await supabaseAdmin.from("bot_logs").insert({
    action: "activation_alert",
    telegram_id: null,
    status: "error",
    details: `${orderId}: ${reason}`.slice(0, 500),
  });
  if (error) {
    console.error(
      "[PRODAMUS WEBHOOK] Failed to persist activation alert:",
      error.message,
    );
    return false;
  }
  return true;
}

async function notifyCancelAfterPaid(orderId: string): Promise<boolean> {
  return sendCoachAlertOnce(
    `cancel_after_paid:${orderId}`,
    `⚠️ Пришла отмена по уже оплаченной заявке ${orderId}. ` +
      `Проверьте, не списаны ли деньги повторно, и при необходимости сделайте возврат.`,
  );
}

async function handleCancellation(orderId: string): Promise<Response> {
  // Числовой order_id Продамуса без order_num не является id нашей заявки.
  // Не отдаём его в uuid-колонку: Postgres вернёт 22P02 и вебхук зациклится.
  if (!UUID_REGEX.test(orderId)) {
    console.warn("[PRODAMUS WEBHOOK] Cancel for non-UUID order");
    return jsonResponse({ ok: true, ignored: "order_id" }, 200);
  }
  // CAS pending -> cancelled: платную заявку не трогаем (возвраты - вне скоупа),
  // повторные отмены идемпотентны.
  const { data: cancelled, error } = await supabaseAdmin
    .from("purchase_requests")
    .update({ status: "cancelled" })
    .eq("id", orderId)
    .eq("status", "pending")
    .select("name, contact, telegram_id, amount, sub_type")
    .maybeSingle();
  if (error) {
    console.error("[PRODAMUS WEBHOOK] Cancel update failed:", error.message);
    return jsonResponse({ ok: false, error: "db" }, 500);
  }
  if (cancelled) {
    await notifyCoachCancellation(cancelled as CancelledRequestRow);
    return jsonResponse({ ok: true, cancelled: true }, 200);
  }

  // Не попали в pending: либо уже обработана, либо её нет.
  const { data: current, error: readError } = await supabaseAdmin
    .from("purchase_requests")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();
  if (readError) {
    console.error(
      "[PRODAMUS WEBHOOK] Cancel re-read failed:",
      readError.message,
    );
    return jsonResponse({ ok: false, error: "db" }, 500);
  }
  if (!current) {
    console.warn("[PRODAMUS WEBHOOK] Cancel for unknown order");
    return jsonResponse({ ok: true }, 200);
  }
  if (current.status === "paid") {
    const alerted = await notifyCancelAfterPaid(orderId);
    if (!alerted) {
      return jsonResponse({ ok: false, error: "alert" }, 500);
    }
  }
  // paid/cancelled - идемпотентный ack; повторная отмена paid не выполняется,
  // но тренер получает предупреждение о гонке отмены с оплатой.
  return jsonResponse({ ok: true, status: current.status }, 200);
}

export async function POST(req: Request): Promise<Response> {
  const secretKey = process.env.PRODAMUS_SECRET_KEY;
  if (!secretKey) {
    console.error("[PRODAMUS WEBHOOK] PRODAMUS_SECRET_KEY is not set");
    return jsonResponse({ ok: false, error: "config" }, 500);
  }

  const contentType = req.headers.get("content-type") ?? "";
  let entries: ProdamusFormEntries;
  try {
    entries = contentType.toLowerCase().includes("multipart/form-data")
      ? await req.formData()
      : await req.text();
  } catch {
    return jsonResponse({ ok: false, error: "body" }, 400);
  }
  const signHeader = req.headers.get("sign");

  if (!verifyProdamusSignature(entries, signHeader, secretKey)) {
    console.error("[PRODAMUS WEBHOOK] Signature verification failed");
    return jsonResponse({ ok: false, error: "signature" }, 400);
  }

  const order = parseProdamusOrder(entries);
  if (!order.orderId) {
    console.error("[PRODAMUS WEBHOOK] Missing order_id in verified payload");
    return jsonResponse({ ok: false, error: "order_id" }, 400);
  }
  const paymentStatus = order.paymentStatus ?? "";

  if (paymentStatus === "success") {
    const result = await activatePurchaseByOrder({
      orderId: order.orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: order.sum,
    });
    if (result.alreadyActivated || !result.error) {
      if (result.warning) {
        const alerted = await notifyCoachActivationFailure(
          order.orderId,
          result.warning,
          order.sum,
        );
        if (!alerted) {
          return jsonResponse({ ok: false, error: "alert" }, 500);
        }
      }
      return jsonResponse({ ok: true }, 200);
    }
    // Незавершённая параллельная активация - нужно повторить позже.
    if (result.inProgress) {
      return jsonResponse({ ok: false, error: "in_progress" }, 503);
    }
    console.error(
      "[PRODAMUS WEBHOOK] Activation failed for",
      order.orderId,
      ":",
      result.error,
    );
    if (result.programAssigned || (!result.retryable && !result.alerted)) {
      const alerted = await notifyCoachActivationFailure(
        order.orderId,
        result.error,
        order.sum,
      );
      if (!alerted && !result.retryable) {
        return jsonResponse({ ok: false, error: "alert" }, 500);
      }
    }
    if (result.retryable) {
      return jsonResponse({ ok: false, error: "activation" }, 500);
    }
    // Постоянная ошибка: Prodamus не должен ретраить её бесконечно.
    return jsonResponse({ ok: false, error: "activation", manual: true }, 200);
  }

  if (CANCEL_STATUSES.has(paymentStatus)) {
    return handleCancellation(order.orderId);
  }

  // Прочие статусы (fail и т.п.) - подтверждаем получение без действий.
  return jsonResponse({ ok: true, ignored: paymentStatus }, 200);
}
