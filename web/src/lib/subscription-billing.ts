// 30.9: подписочные платежи Продамуса (первый, продление, отказ, отмена).
//
// Конвенция заказов: order_num вебхука - это наш UUID из
// subscription_payments.order_id. Первое списание гасит pending-строку CAS,
// повторное списание по тому же order_num - продление: новая строка платежа
// с уникальной парой (subscription_id, period_start) и provider_payment_id
// (внутренний ID платежа Продамуса) как second-factor идемпотентности.
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendTelegramMessage } from "@/lib/telegram";
import { sendCoachAlertOnce } from "@/lib/coach-alert";
import { toFiniteNumber } from "@/lib/activate-purchase";

export type SubscriptionPaymentResult = {
  outcome:
    | "activated"
    | "renewed"
    | "already_processed"
    | "amount_mismatch"
    | "consent_missing"
    | "client_inactive"
    | "cancel_scheduled"
    | "failure_recorded"
    | "db_error";
  retryable?: boolean;
  manual?: boolean;
};

type PlanRow = { period_days: number; price: number };
type SubRow = {
  id: string;
  client_id: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  subscription_plans: PlanRow | PlanRow[] | null;
};
type PaymentRow = {
  id: string;
  order_id: string | null;
  subscription_id: string;
  amount: number;
  status: string;
  provider_payment_id: string | null;
  paid_at: string | null;
  period_start: string | null;
  period_end: string | null;
  applied_at: string | null;
  subscriptions: SubRow | SubRow[] | null;
};
type ClientRow = {
  id: string;
  telegram_id: number | null;
  client_consent_given: boolean;
  client_status: string | null;
  language: string | null;
};

const DAY_MS = 24 * 3600 * 1000;
const DEDUP_TTL_MS = 30 * 24 * 3600 * 1000;
const PAYMENT_SELECT =
  "id, order_id, subscription_id, amount, status, provider_payment_id, paid_at, period_start, period_end, applied_at, subscriptions(id, client_id, status, current_period_end, cancel_at_period_end, subscription_plans(period_days, price))";

function addDays(fromIso: string, days: number): string {
  return new Date(new Date(fromIso).getTime() + days * DAY_MS).toISOString();
}

function planOf(sub: SubRow): PlanRow {
  const plan = Array.isArray(sub.subscription_plans)
    ? sub.subscription_plans[0]
    : sub.subscription_plans;
  if (!plan || !Number.isFinite(plan.period_days) || plan.period_days <= 0) {
    throw new Error("Subscription plan is missing or invalid");
  }
  return plan;
}

function subOf(payment: PaymentRow): SubRow {
  const sub = Array.isArray(payment.subscriptions)
    ? payment.subscriptions[0]
    : payment.subscriptions;
  if (!sub) throw new Error("Subscription is missing");
  return sub;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
}

async function loadPayment(
  orderId: string,
  providerOrderId?: string | null,
): Promise<PaymentRow | null> {
  if (providerOrderId) {
    const byProvider = await supabaseAdmin
      .from("subscription_payments")
      .select(PAYMENT_SELECT)
      .eq("provider_payment_id", providerOrderId)
      .maybeSingle();
    if (byProvider.error) {
      console.error("[SUB_BILLING] Provider payment lookup failed:", byProvider.error.message);
      throw byProvider.error;
    }
    if (byProvider.data) return byProvider.data as unknown as PaymentRow;
  }

  const byOrder = await supabaseAdmin
    .from("subscription_payments")
    .select(PAYMENT_SELECT)
    .eq("order_id", orderId)
    .maybeSingle();
  if (byOrder.error) {
    console.error("[SUB_BILLING] Payment lookup failed:", byOrder.error.message);
    throw byOrder.error;
  }
  return (byOrder.data as unknown as PaymentRow) ?? null;
}

async function loadClient(clientId: string): Promise<ClientRow | null> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("id, telegram_id, client_consent_given, status, language")
    .eq("id", clientId)
    .maybeSingle();
  if (error) {
    console.error("[SUB_BILLING] Client lookup failed:", error.message);
    throw error;
  }
  if (!data) return null;
  const row = data as Omit<ClientRow, "client_status"> & { status: string | null };
  return { ...row, client_status: row.status };
}

async function alertCoachOnce(key: string, text: string): Promise<boolean> {
  return sendCoachAlertOnce(key, text);
}

async function notifyClient(client: ClientRow, text: string): Promise<void> {
  if (client.telegram_id == null) return;
  try {
    const sent = await sendTelegramMessage(client.telegram_id, text);
    if (!sent) console.error("[SUB_BILLING] Client notify failed");
  } catch (err) {
    console.error(
      "[SUB_BILLING] Client notify error:",
      err instanceof Error ? err.message : err,
    );
  }
}

// Один живой подпиской на клиента: новая/возрождённая подписка гасит
// застрявшую живую (хвост ревью 30.8 ###3).
async function evictOtherLiveSubs(
  clientId: string,
  keepSubId: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("subscriptions")
    .update({ status: "cancelled" })
    .eq("client_id", clientId)
    .neq("id", keepSubId)
    .in("status", ["active", "past_due"]);
  if (error) {
    console.error("[SUB_BILLING] Live sub eviction failed:", error.message);
    throw error;
  }
}

// Продление/первый платёж возвращают клиента из access_expired в active
// (хвост ревью 30.8 ###2). inactive трогать нельзя - это решение тренера.
async function restoreExpiredClient(clientId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("clients")
    .update({ status: "active" })
    .eq("id", clientId)
    .eq("status", "access_expired");
  if (error) {
    console.error("[SUB_BILLING] Client restore failed:", error.message);
    throw error;
  }
}

async function loadPaymentByPeriod(
  subscriptionId: string,
  periodStart: string,
): Promise<PaymentRow | null> {
  const { data, error } = await supabaseAdmin
    .from("subscription_payments")
    .select(PAYMENT_SELECT)
    .eq("subscription_id", subscriptionId)
    .eq("period_start", periodStart)
    .maybeSingle();
  if (error) {
    console.error("[SUB_BILLING] Period payment lookup failed:", error.message);
    throw error;
  }
  return (data as unknown as PaymentRow) ?? null;
}

function amountOk(paid: number | null, expected: number): boolean {
  return paid !== null && Number.isFinite(paid) && paid >= expected - 0.005;
}

// Все эффекты оплаты идут в одном месте. Payment->applied_at - конечная
// точка: если прерваться между CAS и эффектами, повтор webhook увидит
// applied_at = null и переиграет их идемпотентно.
async function applyPaymentEffects(
  payment: PaymentRow,
  client: ClientRow,
  outcome: "activated" | "renewed",
): Promise<SubscriptionPaymentResult> {
  const sub = subOf(payment);
  if (!payment.period_start || !payment.period_end) {
    console.error("[SUB_BILLING] Paid period is missing for", payment.id);
    return { outcome: "db_error", retryable: true };
  }
  const paidAt = payment.paid_at ?? new Date().toISOString();

  await evictOtherLiveSubs(sub.client_id, sub.id);
  const { error: subError } = await supabaseAdmin
    .from("subscriptions")
    .update({
      status: "active",
      current_period_start: payment.period_start,
      current_period_end: payment.period_end,
      cancel_at_period_end: false,
      paid_at: paidAt,
      next_payment_at: payment.period_end,
    })
    .eq("id", sub.id);
  if (subError) {
    console.error("[SUB_BILLING] Subscription activation failed:", subError.message);
    return { outcome: "db_error", retryable: true };
  }
  await restoreExpiredClient(sub.client_id);

  const { data: applied, error: appliedError } = await supabaseAdmin
    .from("subscription_payments")
    .update({ applied_at: new Date().toISOString() })
    .eq("id", payment.id)
    .is("applied_at", null)
    .select("id")
    .maybeSingle();
  if (appliedError) {
    console.error("[SUB_BILLING] applied_at update failed:", appliedError.message);
    return { outcome: "db_error", retryable: true };
  }
  if (!applied) return { outcome: "already_processed" };

  await notifyClient(
    client,
    outcome === "activated"
      ? `✅ Подписка активна. Доступ к программам открыт до ${formatDate(payment.period_end)}.`
      : `✅ Подписка продлена. Следующая дата списания и конец доступа: ${formatDate(payment.period_end)}.`,
  );
  return { outcome };
}

export async function handleSubscriptionSuccess({
  orderId,
  paidSum,
  providerOrderId,
}: {
  orderId: string;
  paidSum: number | null;
  providerOrderId: string | null;
}): Promise<SubscriptionPaymentResult> {
  try {
    const payment = await loadPayment(orderId, providerOrderId);
    if (!payment) return { outcome: "db_error", retryable: true };
    const sub = subOf(payment);
    const plan = planOf(sub);
    const client = await loadClient(sub.client_id);
    if (!client) return { outcome: "db_error", retryable: true };
    if (!client.client_consent_given) {
      await alertCoachOnce(
        `sub_consent:${orderId}`,
        `⚠️ Подписка ${orderId} оплачена, но клиент отозвал согласие на обработку данных. Активация заблокирована.`,
      );
      return { outcome: "consent_missing", manual: true };
    }
    if (client.client_status === "inactive") {
      await alertCoachOnce(
        `sub_inactive:${orderId}`,
        `⚠️ Подписка ${orderId} оплачена, но клиент отключён тренером. Активация заблокирована.`,
      );
      return { outcome: "client_inactive", manual: true };
    }
    const paid = toFiniteNumber(paidSum);
    const nowIso = new Date().toISOString();
    const firstRow = payment.order_id === orderId;

    if (payment.status === "success") {
      if (!firstRow) {
        if (payment.applied_at) return { outcome: "already_processed" };
        return applyPaymentEffects(payment, client, "renewed");
      }
      if (
        !providerOrderId ||
        payment.provider_payment_id === providerOrderId
      ) {
        if (payment.applied_at) return { outcome: "already_processed" };
        return applyPaymentEffects(payment, client, "activated");
      }
      // Первая строка уже оплачена, а provider id другой - это продление.
    }

    if (payment.status === "pending") {
      if (!amountOk(paid, payment.amount)) {
        await alertCoachOnce(
          `sub_amount:${orderId}`,
          `⚠️ Подписка ${orderId}: сумма ${paid ?? "-"} ₽ меньше ожидаемой ${payment.amount} ₽. Активация заблокирована.`,
        );
        return { outcome: "amount_mismatch", manual: true };
      }
      const periodStart = nowIso;
      const periodEnd = addDays(periodStart, plan.period_days);
      const { data: captured, error: captureError } = await supabaseAdmin
        .from("subscription_payments")
        .update({
          status: "success",
          paid_at: nowIso,
          period_start: periodStart,
          period_end: periodEnd,
          provider_payment_id: providerOrderId ?? null,
          applied_at: null,
        })
        .eq("id", payment.id)
        .eq("status", "pending")
        .select(PAYMENT_SELECT)
        .maybeSingle();
      if (captureError) {
        console.error("[SUB_BILLING] Capture failed:", captureError.message);
        return { outcome: "db_error", retryable: true };
      }
      if (!captured) {
        const raced = await loadPayment(orderId, providerOrderId);
        if (raced?.status === "success" && !raced.applied_at) {
          return applyPaymentEffects(
            raced,
            client,
            raced.order_id === orderId ? "activated" : "renewed",
          );
        }
        return { outcome: "already_processed" };
      }
      return applyPaymentEffects(captured as PaymentRow, client, "activated");
    }

    if (payment.status !== "success") {
      return { outcome: "already_processed" };
    }

    if (!amountOk(paid, payment.amount)) {
      await alertCoachOnce(
        `sub_renew_amount:${orderId}:${providerOrderId}`,
        `⚠️ Продление подписки ${orderId}: сумма ${paid ?? "-"} ₽ меньше ожидаемой ${payment.amount} ₽. Продление заблокировано.`,
      );
      return { outcome: "amount_mismatch", manual: true };
    }

    const previousEnd = sub.current_period_end;
    const periodStart =
      previousEnd && new Date(previousEnd).getTime() > Date.now()
        ? previousEnd
        : nowIso;
    const periodEnd = addDays(periodStart, plan.period_days);

    const existingByPeriod = await loadPaymentByPeriod(sub.id, periodStart);
    if (existingByPeriod) {
      if (existingByPeriod.provider_payment_id !== providerOrderId) {
        await alertCoachOnce(
          `sub_period_conflict:${orderId}:${providerOrderId}`,
          `⚠️ Продление ${orderId}: период ${periodStart} уже оплачен другим платежом (${existingByPeriod.provider_payment_id ?? "без ID"}). Продление заблокировано.`,
        );
        return { outcome: "already_processed" };
      }
      if (existingByPeriod.applied_at) return { outcome: "already_processed" };
      return applyPaymentEffects(existingByPeriod, client, "renewed");
    }

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("subscription_payments")
      .insert({
        subscription_id: sub.id,
        order_id: null,
        provider_payment_id: providerOrderId,
        amount: paid as number,
        status: "success",
        paid_at: nowIso,
        period_start: periodStart,
        period_end: periodEnd,
        applied_at: null,
      })
      .select(PAYMENT_SELECT)
      .maybeSingle();
    if (insertError) {
      if (insertError.code === "23505") {
        const raced = await loadPaymentByPeriod(sub.id, periodStart);
        if (!raced) return { outcome: "db_error", retryable: true };
        if (raced.provider_payment_id !== providerOrderId) {
          await alertCoachOnce(
            `sub_period_conflict:${orderId}:${providerOrderId}`,
            `⚠️ Продление ${orderId}: период ${periodStart} уже оплачен другим платежом. Продление заблокировано.`,
          );
          return { outcome: "already_processed" };
        }
        if (raced.applied_at) return { outcome: "already_processed" };
        return applyPaymentEffects(raced, client, "renewed");
      }
      console.error("[SUB_BILLING] Renewal insert failed:", insertError.message);
      return { outcome: "db_error", retryable: true };
    }
    if (!inserted) return { outcome: "already_processed" };
    return applyPaymentEffects(inserted as PaymentRow, client, "renewed");
  } catch (err) {
    console.error(
      "[SUB_BILLING] Success handler error:",
      err instanceof Error ? err.message : err,
    );
    return { outcome: "db_error", retryable: true };
  }
}

export async function handleSubscriptionFailure({
  orderId,
  paymentStatus,
  periodEnd,
}: {
  orderId: string;
  paymentStatus: string;
  periodEnd?: string | null;
}): Promise<SubscriptionPaymentResult> {
  const isCancel = ["order_canceled", "order_denied"].includes(paymentStatus);
  try {
    const payment = await loadPayment(orderId);
    if (!payment) return { outcome: "db_error", retryable: true };
    const sub = subOf(payment);
    const client = await loadClient(sub.client_id);
    if (!client) return { outcome: "db_error", retryable: true };

    if (payment.status !== "pending" && sub.status !== "active" && sub.status !== "past_due") {
      return { outcome: "already_processed" };
    }

    if (payment.status !== "pending") {
      if (isCancel) {
        // Внешняя отмена (хвост ревью 30.8 ###1): планируем конец периода
        // и сразу подтверждаем клиенту, чтобы не ждать окно напоминания.
        const end = sub.current_period_end ?? periodEnd ?? null;
        const { error } = await supabaseAdmin
          .from("subscriptions")
          .update({ cancel_at_period_end: true, next_payment_at: null })
          .eq("id", sub.id)
          .eq("cancel_at_period_end", false);
        if (error) {
          console.error("[SUB_BILLING] Cancel scheduling failed:", error.message);
          return { outcome: "db_error", retryable: true };
        }
        await alertCoachOnce(
          `sub_external_cancel:${sub.id}`,
          `Подписка клиента ${client.id} отменена в Продамусе. Доступ до ${end ? formatDate(end) : "конца периода"}.`,
        );
        if (end) {
          await scheduleImmediateExpiryNotice(sub.id, sub.client_id, end, client);
        }
        return { outcome: "cancel_scheduled" };
      }

      // Неуспешное автосписание: past_due держит доступ 3 дня grace,
      // затем cron 30.8 переведёт подписку в expired.
      const { data: moved, error } = await supabaseAdmin
        .from("subscriptions")
        .update({ status: "past_due" })
        .eq("id", sub.id)
        .eq("status", "active")
        .select("id")
        .maybeSingle();
      if (error) {
        console.error("[SUB_BILLING] past_due update failed:", error.message);
        return { outcome: "db_error", retryable: true };
      }
      if (!moved) return { outcome: "already_processed" };
      await alertCoachOnce(
        `sub_renew_fail:${sub.id}:${sub.current_period_end ?? "-"}`,
        `⚠️ Автоплатёж подписки клиента ${client.id} не прошёл. Доступ сохраняется 3 дня после ${sub.current_period_end ? formatDate(sub.current_period_end) : "конца периода"}.`,
      );
      await notifyClient(
        client,
        `⚠️ Автоплатёж подписки не прошёл. Проверьте карту или напишите тренеру. Доступ сохраняется ещё 3 дня после ${sub.current_period_end ? formatDate(sub.current_period_end) : "конца оплаченного периода"}.`,
      );
      return { outcome: "failure_recorded" };
    }

    // Первый платёж не прошёл - заявка остаётся в БД, тренер может
    // перевыпустить ссылку. Отмена заявки закрывает подписку сразу.
    const { error: paymentError } = await supabaseAdmin
      .from("subscription_payments")
      .update({ status: isCancel ? "cancelled" : "failed" })
      .eq("id", payment.id)
      .eq("status", "pending");
    if (paymentError) {
      console.error("[SUB_BILLING] Payment failure update failed:", paymentError.message);
      return { outcome: "db_error", retryable: true };
    }
    if (isCancel) {
      const { error: subError } = await supabaseAdmin
        .from("subscriptions")
        .update({ status: "cancelled" })
        .eq("id", sub.id)
        .eq("status", "pending");
      if (subError) {
        console.error("[SUB_BILLING] Pending sub cancel failed:", subError.message);
        return { outcome: "db_error", retryable: true };
      }
    }
    await alertCoachOnce(
      `sub_first_fail:${orderId}`,
      `⚠️ Первый платёж подписки ${orderId} не прошёл (${paymentStatus}).`,
    );
    return { outcome: "failure_recorded" };
  } catch (err) {
    console.error(
      "[SUB_BILLING] Failure handler error:",
      err instanceof Error ? err.message : err,
    );
    return { outcome: "db_error", retryable: true };
  }
}

// Немедленное подтверждение отмены: тот же dedup-ключ, что у cron 30.8,
// поэтому окно [now+5d, now+6d) не отправит второе сообщение.
export async function scheduleImmediateExpiryNotice(
  subscriptionId: string,
  clientId: string,
  periodEnd: string,
  client?: ClientRow,
): Promise<void> {
  const key = `sub_expiring:${subscriptionId}:${periodEnd}`;
  const { error: dedupError } = await supabaseAdmin.from("bot_dedup").insert({
    key,
    expires_at: new Date(Date.now() + DEDUP_TTL_MS).toISOString(),
  });
  if (dedupError?.code === "23505") return;
  if (dedupError) {
    console.error("[SUB_BILLING] Expiry notice dedup failed:", dedupError.message);
    return;
  }
  const row = client ?? await loadClient(clientId);
  const { error: logError } = await supabaseAdmin.from("notification_log").insert({
    client_id: clientId,
    type: "subscription_expiring",
    status: "sent",
    metadata: { subscription_id: subscriptionId, period_end: periodEnd },
  });
  if (logError?.code === "23505") return;
  if (logError) {
    console.error("[SUB_BILLING] Expiry notice log failed:", logError.message);
    await supabaseAdmin.from("bot_dedup").delete().eq("key", key);
    return;
  }
  if (row) {
    const lang = row.language === "en" ? "en" : "ru";
    const date = formatDate(periodEnd);
    await notifyClient(
      row,
      lang === "en"
        ? `Subscription cancellation scheduled. Access stays active until ${date}.`
        : `Отмена подписки запланирована. Доступ сохранится до ${date}.`,
    );
  }
}
