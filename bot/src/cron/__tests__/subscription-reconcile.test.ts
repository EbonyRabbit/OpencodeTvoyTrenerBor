import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "grammy";
import type { MyContext } from "../../bot.js";

vi.mock("../../lib/supabase-admin.js", () => ({
  supabaseAdmin: { from: vi.fn() },
}));
vi.mock("../logger.js", () => ({ logBotEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../dedup.js", () => ({
  markAsSent: vi.fn().mockResolvedValue("sent"),
  deleteDedup: vi.fn().mockResolvedValue(true),
}));

import { supabaseAdmin } from "../../lib/supabase-admin.js";
import { runSubscriptionReconcile } from "../subscription-reconcile.js";

type Call = { method: string; args: unknown[] };

function makeFakeFrom(overrides: Record<string, unknown[]> = {}) {
  const calls: Record<string, Call[]> = {};
  const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  fake.from.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {};
    const record = (method: string) => (...args: unknown[]) => {
      (calls[table] ??= []).push({ method, args });
      return chain;
    };
    for (const m of ["select", "eq", "in", "lt", "not", "order", "limit", "update", "insert"]) {
      chain[m] = record(m);
    }
    chain.maybeSingle = () =>
      Promise.resolve({
        data: (overrides[table] ?? [])[0] ?? null,
        error: null,
      });
    chain.single = chain.maybeSingle;
    chain.then = (
      onFulfilled: (value: { data: unknown; error: unknown }) => unknown,
    ) =>
      Promise.resolve({
        data: overrides[table] ?? [],
        error: null,
      }).then(onFulfilled);
    return chain;
  });
  return calls;
}

const bot = { api: { sendMessage: vi.fn() } } as unknown as Bot<MyContext>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("runSubscriptionReconcile 30.9", () => {
  it("гасит завершённые отмены и переводит пропущенные продления в past_due", async () => {
    const calls = makeFakeFrom();

    const result = await runSubscriptionReconcile(bot);

    expect(result).toContain("expired=0");
    expect(result).toContain("past_due=0");
    const updates = calls["subscriptions"] ?? [];
    const expired = updates.find(
      (c) => c.method === "update" && (c.args[0] as { status?: string })?.status === "expired",
    );
    const pastDue = updates.find(
      (c) => c.method === "update" && (c.args[0] as { status?: string })?.status === "past_due",
    );
    expect(expired).toBeDefined();
    expect(pastDue).toBeDefined();
    expect(calls["subscriptions"]).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["cancel_at_period_end", true] },
        { method: "eq", args: ["cancel_at_period_end", false] },
      ]),
    );
    const ltCalls = updates.filter((c) => c.method === "lt");
    expect(ltCalls).toHaveLength(2);
    expect(ltCalls[0].args[0]).toBe("current_period_end");
  });

  it("без PRODAMUS_API_BASE_URL внешнюю сверку не делает", async () => {
    makeFakeFrom();

    await runSubscriptionReconcile(bot);

    const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    const tables = fake.from.mock.calls.map(([table]) => table);
    expect(tables).toEqual(["subscriptions", "subscriptions"]);
  });

  it("внешняя отмена из Продамуса планирует конец периода", async () => {
    vi.stubEnv("PRODAMUS_API_BASE_URL", "https://sync.example.ru");
    vi.stubEnv("PRODAMUS_API_TOKEN", "token");
    const providerId = "provider-sub-1";
    const calls = makeFakeFrom({
      subscriptions: [
        {
          id: "sub-1",
          client_id: "client-1",
          provider_subscription_id: providerId,
          current_period_end: "2026-12-01T12:00:00.000Z",
          cancel_at_period_end: false,
        },
      ],
      clients: [{ language: "ru", telegram_id: 777001 }],
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "cancelled" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runSubscriptionReconcile(bot);

    expect(fetchMock).toHaveBeenCalledWith(
      `https://sync.example.ru/api/subscription/${providerId}`,
      expect.objectContaining({ headers: { Authorization: "Bearer token" } }),
    );
    expect(result).toContain("external_checked=1");
    expect(result).toContain("external_cancelled=1");
    const cancelUpdate = (calls["subscriptions"] ?? []).find(
      (c) =>
        c.method === "update" &&
        (c.args[0] as { cancel_at_period_end?: boolean })?.cancel_at_period_end === true,
    );
    expect(cancelUpdate).toBeDefined();
    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      777001,
      expect.stringContaining("Отмена подписки запланирована"),
    );
  });

  it("внешняя отмена с прошедшим периодом гасит подписку сразу", async () => {
    vi.stubEnv("PRODAMUS_API_BASE_URL", "https://sync.example.ru");
    vi.stubEnv("PRODAMUS_API_TOKEN", "token");
    const calls = makeFakeFrom({
      subscriptions: [
        {
          id: "sub-2",
          client_id: "client-2",
          provider_subscription_id: "provider-sub-2",
          current_period_end: "2026-11-01T12:00:00.000Z",
          cancel_at_period_end: false,
        },
      ],
      clients: [{ language: "ru", telegram_id: 777002 }],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ canceled: true }),
      }),
    );

    await runSubscriptionReconcile(bot);

    const cancelUpdate = (calls["subscriptions"] ?? []).find(
      (c) =>
        c.method === "update" &&
        (c.args[0] as { cancel_at_period_end?: boolean })?.cancel_at_period_end === true,
    );
    expect(cancelUpdate?.args[0]).toMatchObject({ status: "expired" });
  });
});
