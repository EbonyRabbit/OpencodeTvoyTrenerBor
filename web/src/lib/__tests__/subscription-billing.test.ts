import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/lib/telegram", () => ({ sendTelegramMessage: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/coach-alert", () => ({ sendCoachAlertOnce: vi.fn().mockResolvedValue(true) }));

import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendTelegramMessage } from "@/lib/telegram";
import { handleSubscriptionSuccess, handleSubscriptionFailure } from "../subscription-billing";

const SUB_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const CLIENT_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const PAYMENT_ID = "cccccccc-3333-4333-8333-333333333333";
const ORDER_ID = "dddddddd-4444-4444-8444-444444444444";
const PLAN = { period_days: 30, price: 4900 };
const PAID_AT = "2026-11-18T12:00:00.000Z";

type Call = { method: string; args: unknown[] };
type State = {
  payment: Record<string, unknown>;
  client: Record<string, unknown>;
  captured: Record<string, unknown> | null;
  renewalRow: Record<string, unknown> | null;
  insertedRow?: Record<string, unknown>;
  renewInsertError: { message: string; code?: string } | null;
  dedupError?: { message: string; code?: string } | null;
  alreadyLogged?: boolean;
  subAlreadyPastDue?: boolean;
};

function mockDb(state: State) {
  const calls: Record<string, Call[]> = {};
  let inserting = false;
  const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  fake.from.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {};
    let lookupKind: "order" | "provider" | "period" | null = null;
    let didUpdate = false;
    const record = (method: string) => (...args: unknown[]) => {
      (calls[table] ??= []).push({ method, args });
      if (method === "update") didUpdate = true;
      if (method === "eq") {
        if (args[0] === "period_start") lookupKind = "period";
        if (args[0] === "order_id") lookupKind = "order";
        if (args[0] === "provider_payment_id") lookupKind = "provider";
      }
      return chain;
    };
    for (const m of [
      "select", "neq", "in", "lt", "gte", "order", "limit",
      "update", "delete", "is",
    ]) {
      chain[m] = record(m);
    }
    chain.eq = record("eq");
    chain.maybeSingle = () => {
      if (table === "bot_dedup") return Promise.resolve({ data: null, error: null });
      if (table === "notification_log") {
        return Promise.resolve({
          data: state.alreadyLogged ? { id: "log-1" } : null,
          error: null,
        });
      }
      if (inserting) {
        inserting = false;
        return Promise.resolve({
          data: state.renewInsertError ? null : (state.insertedRow ?? { id: "renew-1" }),
          error: state.renewInsertError,
        });
      }
      if (table === "subscription_payments") {
        const data = didUpdate
          ? (state.captured ?? state.payment)
          : lookupKind === "period"
            ? state.renewalRow
            : state.payment;
        return Promise.resolve({ data, error: null });
      }
      if (table === "subscriptions" && didUpdate) {
        return Promise.resolve({
          data: state.subAlreadyPastDue ? null : { id: SUB_ID },
          error: null,
        });
      }
      if (table === "clients") return Promise.resolve({ data: state.client, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    chain.single = chain.maybeSingle;
    chain.insert = (...args: unknown[]) => {
      (calls[table] ??= []).push({ method: "insert", args });
      if (table === "bot_dedup" && state.dedupError) {
        return Promise.resolve({ data: null, error: state.dedupError });
      }
      if (table === "subscription_payments") inserting = true;
      return chain;
    };
    chain.then = (
      onFulfilled: (value: { data: unknown; error: unknown }) => unknown,
    ) =>
      Promise.resolve({
        data:
          table === "subscription_payments"
            ? [state.captured ?? state.payment]
            : [],
        error: null,
      }).then(onFulfilled);
    return chain;
  });
  return calls;
}

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_ID,
    order_id: ORDER_ID,
    subscription_id: SUB_ID,
    amount: 4900,
    status: "pending",
    provider_payment_id: null,
    paid_at: null,
    period_start: null,
    period_end: null,
    applied_at: null,
    subscriptions: {
      id: SUB_ID,
      client_id: CLIENT_ID,
      status: "active",
      current_period_end: "2026-12-01T12:00:00.000Z",
      cancel_at_period_end: false,
      subscription_plans: PLAN,
    },
    ...overrides,
  };
}

function capturedRow(overrides: Record<string, unknown> = {}) {
  return paymentRow({
    status: "success",
    provider_payment_id: "100500",
    paid_at: PAID_AT,
    period_start: PAID_AT,
    period_end: "2026-12-18T12:00:00.000Z",
    ...overrides,
  });
}

function renewalRow(overrides: Record<string, unknown> = {}) {
  return capturedRow({
    id: "renew-1",
    order_id: null,
    provider_payment_id: "100501",
    period_start: "2026-12-01T12:00:00.000Z",
    period_end: "2026-12-31T12:00:00.000Z",
    ...overrides,
  });
}

const clientRow = {
  id: CLIENT_ID,
  status: "active",
  telegram_id: 12345,
  client_consent_given: true,
  language: "ru",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("30.9 подписочные платежи", () => {
  it("первый платёж: CAS, активная подписка и возврат клиента из access_expired", async () => {
    const state: State = {
      payment: paymentRow(),
      client: { ...clientRow, status: "access_expired" },
      captured: capturedRow(),
      renewalRow: null,
      renewInsertError: null,
    };
    const calls = mockDb(state);

    const result = await handleSubscriptionSuccess({
      orderId: ORDER_ID,
      paidSum: 4900,
      providerOrderId: "100500",
    });

    expect(result.outcome).toBe("activated");
    const subUpdate = (calls["subscriptions"] ?? []).find(
      (c) => c.method === "update" && (c.args[0] as { status?: string })?.status === "active",
    );
    expect(subUpdate).toBeDefined();
    expect(calls["clients"]).toEqual(
      expect.arrayContaining([
        { method: "update", args: [{ status: "active" }] },
        { method: "eq", args: ["status", "access_expired"] },
      ]),
    );
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      12345,
      expect.stringContaining("Подписка активна"),
    );
  });

  it("суржик первого платежа с тем же provider id не продлевает", async () => {
    const state: State = {
      payment: capturedRow({ applied_at: PAID_AT }),
      client: clientRow,
      captured: null,
      renewalRow: null,
      renewInsertError: null,
    };
    const calls = mockDb(state);

    const result = await handleSubscriptionSuccess({
      orderId: ORDER_ID,
      paidSum: 4900,
      providerOrderId: "100500",
    });

    expect(result.outcome).toBe("already_processed");
    expect(calls["subscription_payments"]?.filter((c) => c.method === "insert")).toHaveLength(0);
  });

  it("новый provider id - продление: новая строка платежа и сдвиг периода", async () => {
    const state: State = {
      payment: capturedRow({ applied_at: PAID_AT }),
      client: clientRow,
      captured: null,
      renewalRow: null,
      insertedRow: renewalRow(),
      renewInsertError: null,
    };
    const calls = mockDb(state);

    const result = await handleSubscriptionSuccess({
      orderId: ORDER_ID,
      paidSum: 4900,
      providerOrderId: "100501",
    });

    expect(result.outcome).toBe("renewed");
    const insert = (calls["subscription_payments"] ?? []).find((c) => c.method === "insert");
    expect(insert?.args[0]).toMatchObject({
      provider_payment_id: "100501",
      status: "success",
      applied_at: null,
      period_start: "2026-12-01T12:00:00.000Z",
      period_end: "2026-12-31T12:00:00.000Z",
    });
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      12345,
      expect.stringContaining("Подписка продлена"),
    );
  });

  it("дубль продления по уникальному периоду - уже обработан", async () => {
    const state: State = {
      payment: capturedRow({ applied_at: PAID_AT }),
      client: clientRow,
      captured: null,
      renewalRow: renewalRow({ applied_at: PAID_AT }),
      renewInsertError: { message: "duplicate", code: "23505" },
    };
    mockDb(state);

    const result = await handleSubscriptionSuccess({
      orderId: ORDER_ID,
      paidSum: 4900,
      providerOrderId: "100501",
    });

    expect(result.outcome).toBe("already_processed");
  });

  it("недовнесённая сумма блокирует активацию", async () => {
    const state: State = {
      payment: paymentRow(),
      client: clientRow,
      captured: capturedRow(),
      renewalRow: null,
      renewInsertError: null,
    };
    mockDb(state);

    const result = await handleSubscriptionSuccess({
      orderId: ORDER_ID,
      paidSum: 100,
      providerOrderId: "100500",
    });

    expect(result).toMatchObject({ outcome: "amount_mismatch", manual: true });
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("переигрывает эффекты первого платежа, если платёж уже success, а applied_at пуст", async () => {
    const state: State = {
      payment: capturedRow(),
      client: clientRow,
      captured: null,
      renewalRow: null,
      renewInsertError: null,
    };
    const calls = mockDb(state);

    const result = await handleSubscriptionSuccess({
      orderId: ORDER_ID,
      paidSum: 4900,
      providerOrderId: "100500",
    });

    expect(result.outcome).toBe("activated");
    expect(calls["subscription_payments"]?.filter((c) => c.method === "insert")).toHaveLength(0);
    const subUpdate = (calls["subscriptions"] ?? []).find(
      (c) => c.method === "update" && (c.args[0] as { status?: string })?.status === "active",
    );
    expect(subUpdate).toBeDefined();
  });

  it("переигрывает эффекты продления, если строка продления уже есть, но applied_at пуст", async () => {
    const state: State = {
      payment: capturedRow({ applied_at: PAID_AT }),
      client: clientRow,
      captured: null,
      renewalRow: renewalRow(),
      renewInsertError: null,
    };
    const calls = mockDb(state);

    const result = await handleSubscriptionSuccess({
      orderId: ORDER_ID,
      paidSum: 4900,
      providerOrderId: "100501",
    });

    expect(result.outcome).toBe("renewed");
    expect(calls["subscription_payments"]?.filter((c) => c.method === "insert")).toHaveLength(0);
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      12345,
      expect.stringContaining("Подписка продлена"),
    );
  });

  it("неуспех автоплатежа → past_due и предупреждение клиенту", async () => {
    const state: State = {
      payment: capturedRow(),
      client: clientRow,
      captured: null,
      renewalRow: null,
      renewInsertError: null,
    };
    const calls = mockDb(state);

    const result = await handleSubscriptionFailure({
      orderId: ORDER_ID,
      paymentStatus: "fail",
    });

    expect(result.outcome).toBe("failure_recorded");
    expect(calls["subscriptions"]).toEqual(
      expect.arrayContaining([
        { method: "update", args: [{ status: "past_due" }] },
      ]),
    );
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      12345,
      expect.stringContaining("Автоплатёж"),
    );
  });

  it("повтор fail по уже past_due не шлёт клиенту второе сообщение", async () => {
    const state: State = {
      payment: capturedRow(),
      client: clientRow,
      captured: null,
      renewalRow: null,
      renewInsertError: null,
    };
    mockDb(state);

    const first = await handleSubscriptionFailure({
      orderId: ORDER_ID,
      paymentStatus: "fail",
    });
    state.subAlreadyPastDue = true;
    const second = await handleSubscriptionFailure({
      orderId: ORDER_ID,
      paymentStatus: "fail",
    });

    expect(first.outcome).toBe("failure_recorded");
    expect(second.outcome).toBe("already_processed");
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it("оплата для inactive клиента блокируется вручную", async () => {
    const state: State = {
      payment: paymentRow(),
      client: { ...clientRow, status: "inactive" },
      captured: capturedRow(),
      renewalRow: null,
      renewInsertError: null,
    };
    mockDb(state);

    const result = await handleSubscriptionSuccess({
      orderId: ORDER_ID,
      paidSum: 4900,
      providerOrderId: "100500",
    });

    expect(result).toMatchObject({ outcome: "client_inactive", manual: true });
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("внешняя отмена: отмена в конце периода и сразу dedup + notification_log", async () => {
    const state: State = {
      payment: capturedRow(),
      client: clientRow,
      captured: null,
      renewalRow: null,
      renewInsertError: null,
    };
    const calls = mockDb(state);

    const result = await handleSubscriptionFailure({
      orderId: ORDER_ID,
      paymentStatus: "order_canceled",
    });

    expect(result.outcome).toBe("cancel_scheduled");
    expect(calls["subscriptions"]).toEqual(
      expect.arrayContaining([
        {
          method: "update",
          args: [{ cancel_at_period_end: true, next_payment_at: null }],
        },
      ]),
    );
    expect(calls["bot_dedup"]?.[0].args[0]).toMatchObject({
      key: expect.stringContaining(`sub_expiring:${SUB_ID}:`),
    });
    expect(calls["notification_log"]?.[0].args[0]).toMatchObject({
      type: "subscription_expiring",
    });
  });

  it("повтор отмены при живом dedup не шлёт второе уведомление", async () => {
    const state: State = {
      payment: capturedRow(),
      client: clientRow,
      captured: null,
      renewalRow: null,
      renewInsertError: null,
      dedupError: null,
    };
    const calls = mockDb(state);

    const first = await handleSubscriptionFailure({
      orderId: ORDER_ID,
      paymentStatus: "order_canceled",
    });
    state.dedupError = { message: "duplicate", code: "23505" };
    const second = await handleSubscriptionFailure({
      orderId: ORDER_ID,
      paymentStatus: "order_canceled",
    });

    expect(first.outcome).toBe("cancel_scheduled");
    expect(second.outcome).toBe("cancel_scheduled");
    expect(calls["notification_log"]?.filter((c) => c.method === "insert")).toHaveLength(1);
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
  });
});
