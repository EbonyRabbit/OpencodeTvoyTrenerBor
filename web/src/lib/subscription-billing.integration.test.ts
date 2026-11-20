import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  handleSubscriptionFailure,
  handleSubscriptionSuccess,
} from "@/lib/subscription-billing";
import { PRIVACY_POLICY_VERSION } from "@/lib/consent";
import { resetDb } from "@/test/integration/db";

const mocks = vi.hoisted(() => ({
  sendTelegramMessage: vi.fn(),
  sendCoachAlertOnce: vi.fn(),
}));

vi.mock("@/lib/telegram", () => ({
  sendTelegramMessage: mocks.sendTelegramMessage,
}));

vi.mock("@/lib/coach-alert", () => ({
  sendCoachAlertOnce: mocks.sendCoachAlertOnce,
}));

const TELEGRAM_ID = 777900;

async function seedPlan() {
  const { data, error } = await supabaseAdmin
    .from("subscription_plans")
    .insert({
      code: "int-monthly",
      title: "Интеграционная подписка",
      price: 4900,
      period_days: 30,
    })
    .select("id, price, period_days")
    .single();
  if (error || !data) throw error ?? new Error("plan seed failed");
  return data;
}

async function seedClient(
  status: "active" | "inactive" | "access_expired" = "access_expired",
) {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .insert({
      name: "Подписочный клиент",
      telegram_id: TELEGRAM_ID,
      timezone: "UTC",
      status,
      language: "ru",
      client_consent_given: true,
      client_consent_version: PRIVACY_POLICY_VERSION,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("client seed failed");
  return data.id;
}

async function seedSubscription(clientId: string, planId: string) {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .insert({
      client_id: clientId,
      plan_id: planId,
      provider: "prodamus",
      provider_subscription_id: `sub_${randomUUID()}`,
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("subscription seed failed");
  return data.id;
}

async function seedPayment(subscriptionId: string, amount: number) {
  const orderId = randomUUID();
  const { error } = await supabaseAdmin.from("subscription_payments").insert({
    subscription_id: subscriptionId,
    order_id: orderId,
    amount,
    status: "pending",
  });
  if (error) throw error;
  return orderId;
}

async function getPayment(orderId: string) {
  const { data, error } = await supabaseAdmin
    .from("subscription_payments")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getSubscription(id: string) {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

async function getClient(id: string) {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
  mocks.sendTelegramMessage.mockResolvedValue(true);
  mocks.sendCoachAlertOnce.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("30.9 subscription billing on real data", () => {
  it("активирует первую оплату и возвращает access_expired клиента", async () => {
    const plan = await seedPlan();
    const clientId = await seedClient();
    const subId = await seedSubscription(clientId, plan.id);
    const orderId = await seedPayment(subId, plan.price);

    const result = await handleSubscriptionSuccess({
      orderId,
      paidSum: plan.price,
      providerOrderId: "provider-1",
    });

    expect(result.outcome).toBe("activated");
    const sub = await getSubscription(subId);
    expect(sub.status).toBe("active");
    expect(sub.current_period_start).toBeTruthy();
    expect(sub.current_period_end).toBeTruthy();
    expect(sub.cancel_at_period_end).toBe(false);
    expect(new Date(sub.current_period_end!).getTime()).toBeGreaterThan(
      new Date(sub.current_period_start!).getTime(),
    );
    const payment = await getPayment(orderId);
    expect(payment).toMatchObject({
      status: "success",
      provider_payment_id: "provider-1",
      amount: plan.price,
    });
    expect((await getClient(clientId)).status).toBe("active");
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(
      TELEGRAM_ID,
      expect.stringContaining("Подписка активна"),
    );
  });

  it("вытесняет старую живую подписку при реактивации клиента", async () => {
    const plan = await seedPlan();
    const clientId = await seedClient("active");
    const oldSubId = await seedSubscription(clientId, plan.id);
    const { error: activateError } = await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "active",
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        cancel_at_period_end: true,
      })
      .eq("id", oldSubId);
    expect(activateError).toBeNull();

    const subId = await seedSubscription(clientId, plan.id);
    const orderId = await seedPayment(subId, plan.price);

    const result = await handleSubscriptionSuccess({
      orderId,
      paidSum: plan.price,
      providerOrderId: "provider-reactivate",
    });

    expect(result.outcome).toBe("activated");
    expect((await getSubscription(oldSubId)).status).toBe("cancelled");
    expect((await getSubscription(subId)).status).toBe("active");
  });

  it("переигрывает эффекты оплаты, если платёж уже success, но applied_at пуст", async () => {
    const plan = await seedPlan();
    const clientId = await seedClient();
    const subId = await seedSubscription(clientId, plan.id);
    const orderId = await seedPayment(subId, plan.price);
    const paidAt = new Date().toISOString();
    const periodEnd = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const { error } = await supabaseAdmin
      .from("subscription_payments")
      .update({
        status: "success",
        paid_at: paidAt,
        period_start: paidAt,
        period_end: periodEnd,
        provider_payment_id: "provider-1",
        applied_at: null,
      })
      .eq("order_id", orderId);
    expect(error).toBeNull();

    const result = await handleSubscriptionSuccess({
      orderId,
      paidSum: plan.price,
      providerOrderId: "provider-1",
    });

    expect(result.outcome).toBe("activated");
    expect((await getSubscription(subId)).status).toBe("active");
    expect((await getClient(clientId)).status).toBe("active");
    expect((await getPayment(orderId))?.applied_at).toBeTruthy();
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(
      TELEGRAM_ID,
      expect.stringContaining("Подписка активна"),
    );
  });

  it("переигрывает продление, если строка платежа есть, но applied_at пуст", async () => {
    const plan = await seedPlan();
    const clientId = await seedClient("active");
    const subId = await seedSubscription(clientId, plan.id);
    const orderId = await seedPayment(subId, plan.price);
    await handleSubscriptionSuccess({
      orderId,
      paidSum: plan.price,
      providerOrderId: "provider-1",
    });
    const before = await getSubscription(subId);
    const periodStart = before.current_period_end!;
    const periodEnd = new Date(
      new Date(periodStart).getTime() + 30 * 24 * 3600 * 1000,
    ).toISOString();
    const { error } = await supabaseAdmin.from("subscription_payments").insert({
      subscription_id: subId,
      order_id: null,
      provider_payment_id: "provider-2",
      amount: plan.price,
      status: "success",
      paid_at: new Date().toISOString(),
      period_start: periodStart,
      period_end: periodEnd,
      applied_at: null,
    });
    expect(error).toBeNull();

    const result = await handleSubscriptionSuccess({
      orderId,
      paidSum: plan.price,
      providerOrderId: "provider-2",
    });

    expect(result.outcome).toBe("renewed");
    const after = await getSubscription(subId);
    expect(new Date(after.current_period_start!).getTime()).toBe(
      new Date(periodStart).getTime(),
    );
    expect(new Date(after.current_period_end!).getTime()).toBe(
      new Date(periodEnd).getTime(),
    );
    const { data: payments } = await supabaseAdmin
      .from("subscription_payments")
      .select("applied_at")
      .eq("subscription_id", subId);
    expect(payments?.filter((p) => p.applied_at)).toHaveLength(2);
  });

  it("повтор первого вебхука не создаёт второй платёж", async () => {
    const plan = await seedPlan();
    const clientId = await seedClient();
    const subId = await seedSubscription(clientId, plan.id);
    const orderId = await seedPayment(subId, plan.price);

    const first = await handleSubscriptionSuccess({
      orderId,
      paidSum: plan.price,
      providerOrderId: "provider-1",
    });
    const replay = await handleSubscriptionSuccess({
      orderId,
      paidSum: plan.price,
      providerOrderId: "provider-1",
    });

    expect(first.outcome).toBe("activated");
    expect(replay.outcome).toBe("already_processed");
    const { data: payments, error } = await supabaseAdmin
      .from("subscription_payments")
      .select("id")
      .eq("subscription_id", subId);
    expect(error).toBeNull();
    expect(payments).toHaveLength(1);
  });

  it("продление с новым provider id удлиняет период и пишет отдельный платёж", async () => {
    const plan = await seedPlan();
    const clientId = await seedClient("active");
    const subId = await seedSubscription(clientId, plan.id);
    const orderId = await seedPayment(subId, plan.price);

    const first = await handleSubscriptionSuccess({
      orderId,
      paidSum: plan.price,
      providerOrderId: "provider-1",
    });
    const before = await getSubscription(subId);
    const renew = await handleSubscriptionSuccess({
      orderId,
      paidSum: plan.price,
      providerOrderId: "provider-2",
    });

    expect(first.outcome).toBe("activated");
    expect(renew.outcome).toBe("renewed");
    const after = await getSubscription(subId);
    expect(new Date(after.current_period_end!).getTime()).toBe(
      new Date(before.current_period_end!).getTime() + 30 * 24 * 3600 * 1000,
    );
    expect(after.current_period_start).toBe(before.current_period_end);
    const { data: payments, error } = await supabaseAdmin
      .from("subscription_payments")
      .select("provider_payment_id, period_start, period_end")
      .eq("subscription_id", subId);
    expect(error).toBeNull();
    expect(payments).toHaveLength(2);
    expect(payments?.map((p) => p.provider_payment_id).sort()).toEqual([
      "provider-1",
      "provider-2",
    ]);
  });

  it("дубль продления с тем же provider id не ломает период", async () => {
    const plan = await seedPlan();
    const clientId = await seedClient("active");
    const subId = await seedSubscription(clientId, plan.id);
    const orderId = await seedPayment(subId, plan.price);

    await handleSubscriptionSuccess({
      orderId,
      paidSum: plan.price,
      providerOrderId: "provider-1",
    });
    const renew = await handleSubscriptionSuccess({
      orderId,
      paidSum: plan.price,
      providerOrderId: "provider-2",
    });
    const before = await getSubscription(subId);
    const duplicate = await handleSubscriptionSuccess({
      orderId,
      paidSum: plan.price,
      providerOrderId: "provider-2",
    });
    const after = await getSubscription(subId);

    expect(renew.outcome).toBe("renewed");
    expect(duplicate.outcome).toBe("already_processed");
    expect(after.current_period_end).toBe(before.current_period_end);
    const { data: payments } = await supabaseAdmin
      .from("subscription_payments")
      .select("id")
      .eq("subscription_id", subId);
    expect(payments).toHaveLength(2);
  });

  it("неуспешное автопродление уводит подписку в past_due", async () => {
    const plan = await seedPlan();
    const clientId = await seedClient("active");
    const subId = await seedSubscription(clientId, plan.id);
    const orderId = await seedPayment(subId, plan.price);
    await handleSubscriptionSuccess({
      orderId,
      paidSum: plan.price,
      providerOrderId: "provider-1",
    });

    const result = await handleSubscriptionFailure({
      orderId,
      paymentStatus: "fail",
    });

    expect(result.outcome).toBe("failure_recorded");
    expect((await getSubscription(subId)).status).toBe("past_due");
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(
      TELEGRAM_ID,
      expect.stringContaining("Автоплатёж"),
    );
  });

  it("повтор fail после past_due не шлёт клиенту второе сообщение", async () => {
    const plan = await seedPlan();
    const clientId = await seedClient("active");
    const subId = await seedSubscription(clientId, plan.id);
    const orderId = await seedPayment(subId, plan.price);
    await handleSubscriptionSuccess({
      orderId,
      paidSum: plan.price,
      providerOrderId: "provider-1",
    });

    const first = await handleSubscriptionFailure({
      orderId,
      paymentStatus: "fail",
    });
    mocks.sendTelegramMessage.mockClear();
    const second = await handleSubscriptionFailure({
      orderId,
      paymentStatus: "fail",
    });

    expect(first.outcome).toBe("failure_recorded");
    expect(second.outcome).toBe("already_processed");
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("не активирует оплату для клиента, отключённого тренером", async () => {
    const plan = await seedPlan();
    const clientId = await seedClient("inactive");
    const subId = await seedSubscription(clientId, plan.id);
    const orderId = await seedPayment(subId, plan.price);

    const result = await handleSubscriptionSuccess({
      orderId,
      paidSum: plan.price,
      providerOrderId: "provider-1",
    });

    expect(result).toMatchObject({ outcome: "client_inactive", manual: true });
    expect((await getSubscription(subId)).status).toBe("pending");
    expect((await getClient(clientId)).status).toBe("inactive");
  });

  it("отмена Продамуса помечает конец периода и пишет уведомление и dedup", async () => {
    const plan = await seedPlan();
    const clientId = await seedClient("active");
    const subId = await seedSubscription(clientId, plan.id);
    const orderId = await seedPayment(subId, plan.price);
    await handleSubscriptionSuccess({
      orderId,
      paidSum: plan.price,
      providerOrderId: "provider-1",
    });

    const result = await handleSubscriptionFailure({
      orderId,
      paymentStatus: "order_canceled",
    });

    expect(result.outcome).toBe("cancel_scheduled");
    const sub = await getSubscription(subId);
    expect(sub.cancel_at_period_end).toBe(true);
    expect(sub.next_payment_at).toBeNull();
    const { data: dedup, error: dedupError } = await supabaseAdmin
      .from("bot_dedup")
      .select("key")
      .like("key", `sub_expiring:${subId}:%`);
    expect(dedupError).toBeNull();
    expect(dedup).toHaveLength(1);
    const { data: log, error: logError } = await supabaseAdmin
      .from("notification_log")
      .select("type")
      .eq("client_id", clientId);
    expect(logError).toBeNull();
    expect(log?.[0]?.type).toBe("subscription_expiring");
  });
});
