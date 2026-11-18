import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/dal", () => ({ verifySession: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/lib/prodamus", () => ({
  resolvePaymentUrl: vi.fn(async ({ amount }: { amount: number }) =>
    `https://payform.test/?amount=${amount}`,
  ),
}));

import { verifySession } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { resolvePaymentUrl } from "@/lib/prodamus";
import { createSubscriptionPaymentLink } from "../actions";

const CLIENT_ID = "11111111-2222-3333-4444-555555555555";
const COACH_ID = "22222222-2222-2222-2222-222222222222";
const SUB_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const PAYMENT_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const ORDER_ID = "cccccccc-3333-4333-8333-333333333333";
const PLAN = { id: "dddddddd-4444-4444-8444-444444444444", title: "Подписка", price: 4900 };

type Call = { method: string; args: unknown[] };
type State = {
  client: Record<string, unknown> | null;
  liveSub: Record<string, unknown> | null;
  pendingSub: Record<string, unknown> | null;
  pendingPayment: Record<string, unknown> | null;
  plan: Record<string, unknown> | null;
  subInsertError?: { code?: string; message: string } | null;
  paymentInsertError?: { code?: string; message: string } | null;
  subSyncMiss?: boolean;
  paymentSyncMiss?: boolean;
  onPendingSubLookup?: () => void;
};

function mockDb(state: State) {
  const calls: Record<string, Call[]> = {};
  const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  fake.from.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {};
    let liveLookup = false;
    let pendingLookup = false;
    let didUpdate = false;
    const record = (method: string) => (...args: unknown[]) => {
      (calls[table] ??= []).push({ method, args });
      if (method === "update") didUpdate = true;
      if (method === "in" && args[0] === "status") liveLookup = true;
      if (method === "eq" && args[0] === "status" && args[1] === "pending") {
        pendingLookup = true;
      }
      return chain;
    };
    for (const m of ["select", "eq", "in", "order", "limit", "update"]) chain[m] = record(m);
    chain.insert = (...args: unknown[]) => {
      (calls[table] ??= []).push({ method: "insert", args });
      if (table === "subscriptions") {
        return Promise.resolve({ error: state.subInsertError ?? null });
      }
      if (table === "subscription_payments") {
        return Promise.resolve({ error: state.paymentInsertError ?? null });
      }
      return Promise.resolve({ error: null });
    };
    chain.maybeSingle = () => {
      if (didUpdate && table === "subscriptions") {
        return Promise.resolve({
          data: state.subSyncMiss ? null : { id: SUB_ID },
          error: null,
        });
      }
      if (didUpdate && table === "subscription_payments") {
        return Promise.resolve({
          data: state.paymentSyncMiss ? null : { id: PAYMENT_ID },
          error: null,
        });
      }
      if (table === "clients") return Promise.resolve({ data: state.client, error: null });
      if (table === "subscription_plans") return Promise.resolve({ data: state.plan, error: null });
      if (table === "subscriptions") {
        if (liveLookup) return Promise.resolve({ data: state.liveSub, error: null });
        if (pendingLookup) {
          state.onPendingSubLookup?.();
          return Promise.resolve({ data: state.pendingSub, error: null });
        }
      }
      if (table === "subscription_payments") {
        return Promise.resolve({ data: state.pendingPayment, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    chain.then = (
      onFulfilled: (value: { error: unknown }) => unknown,
    ) => Promise.resolve({ error: null }).then(onFulfilled);
    return chain;
  });
  return calls;
}

const baseState = (): State => ({
  client: {
    id: CLIENT_ID,
    status: "active",
    telegram_id: 12345,
    client_consent_given: true,
  },
  liveSub: null,
  pendingSub: { id: SUB_ID },
  pendingPayment: null,
  plan: PLAN,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PRODAMUS_PAYFORM_BASE_URL", "https://payform.test");
  vi.mocked(verifySession).mockResolvedValue({
    profile: { id: COACH_ID, role: "admin" },
  } as never);
});

describe("createSubscriptionPaymentLink", () => {
  it("синхронизирует сумму существующего pending-платежа с актуальным тарифом", async () => {
    const state = baseState();
    state.pendingPayment = { id: PAYMENT_ID, order_id: ORDER_ID };
    const calls = mockDb(state);

    const result = await createSubscriptionPaymentLink(CLIENT_ID);

    expect(result.error).toBeUndefined();
    expect(result.paymentId).toBe(PAYMENT_ID);
    expect(calls["subscription_payments"]).toEqual(
      expect.arrayContaining([
        { method: "update", args: [{ order_id: ORDER_ID, amount: 4900 }] },
      ]),
    );
    expect(calls["subscription_payments"]?.some((c) => c.method === "insert")).toBe(false);
    expect(resolvePaymentUrl).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: ORDER_ID, amount: 4900 }),
    );
  });

  it("переиспользует pending-подписку и создаёт только новый платёж", async () => {
    const state = baseState();
    const calls = mockDb(state);

    const result = await createSubscriptionPaymentLink(CLIENT_ID);

    expect(result.error).toBeUndefined();
    expect(calls["subscriptions"]?.some((c) => c.method === "insert")).toBe(false);
    expect(calls["subscription_payments"]?.filter((c) => c.method === "insert")).toHaveLength(1);
    expect(result.url).toBe("https://payform.test/?amount=4900");
  });

  it("переиспользует подписку при гонке вставки 23505", async () => {
    const state = baseState();
    state.pendingSub = null;
    state.subInsertError = { code: "23505", message: "duplicate" };
    let lookups = 0;
    state.onPendingSubLookup = () => {
      lookups += 1;
      if (lookups === 2) state.pendingSub = { id: SUB_ID };
    };
    const calls = mockDb(state);

    const result = await createSubscriptionPaymentLink(CLIENT_ID);

    expect(result.error).toBeUndefined();
    expect(calls["subscription_payments"]?.filter((c) => c.method === "insert")).toHaveLength(1);
    expect(
      calls["subscription_payments"]?.find((c) => c.method === "insert")?.args[0],
    ).toMatchObject({
      subscription_id: SUB_ID,
      amount: 4900,
    });
  });

  it("fail closed если pending-платёж успел сменить статус во время синхронизации", async () => {
    const state = baseState();
    state.pendingPayment = { id: PAYMENT_ID, order_id: ORDER_ID };
    state.paymentSyncMiss = true;
    mockDb(state);

    const result = await createSubscriptionPaymentLink(CLIENT_ID);

    expect(result.error).toBe("Ссылка устарела. Попробуй заново");
    expect(result.url).toBeUndefined();
    expect(resolvePaymentUrl).not.toHaveBeenCalled();
  });

  it("блокирует отключённого клиента", async () => {
    const state = baseState();
    state.client = { ...state.client, status: "inactive" };
    mockDb(state);

    const result = await createSubscriptionPaymentLink(CLIENT_ID);

    expect(result.error).toBe("Клиент отключён. Сначала верни доступ");
  });
});
