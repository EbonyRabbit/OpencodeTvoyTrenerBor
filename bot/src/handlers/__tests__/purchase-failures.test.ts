import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("../../config.js", () => ({
  config: {
    telegram: { botToken: "test", webhookSecret: "test" },
    supabase: { url: "http://127.0.0.1:54321", serviceRoleKey: "test" },
    coachChatId: 0n,
    prodamusPayformBaseUrl: "https://pay.demo.prodamus.ru/payment",
    clientPortalUrl: "https://portal.example.com",
    nodeEnv: "test",
    port: 3001,
    webhookPath: "/webhook",
    publicUrl: "",
  },
}));

vi.mock("../../lib/clients.js", () => ({
  findClientByTelegramId: vi.fn(),
}));

vi.mock("../../lib/supabase-admin.js", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { supabaseAdmin } from "../../lib/supabase-admin.js";
import { findClientByTelegramId } from "../../lib/clients.js";
import { startCoachRequest, startPurchase } from "../purchase.js";
import type { MyContext } from "../../bot.js";

function makeCtx(): MyContext {
  return {
    from: { id: 123456789, username: "buyer", first_name: "Иван" },
    language: "ru",
    reply: vi.fn().mockResolvedValue({}),
    answerCallbackQuery: vi.fn().mockResolvedValue({}),
  } as unknown as MyContext;
}

function programChain() {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({
      data: { id: randomUUID(), title: "Сила", price: 5900 },
      error: null,
    })),
  };
  return chain;
}

const insertCalls: ReturnType<typeof vi.fn>[] = [];

function failingPurchaseChain() {
  let headRequest = false;
  const insert = vi.fn(() => {
    throw new Error("insert must not run");
  });
  insertCalls.push(insert);
  const chain = {
    insert,
    select: vi.fn((_columns: unknown, options?: { head?: boolean }) => {
      headRequest = options?.head === true;
      return chain;
    }),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(
        headRequest
          ? { count: null, error: { message: "count failed" } }
          : { data: null, error: null },
      ).then(resolve),
  };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls.length = 0;
  const from = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  from.from.mockImplementation((table: string) =>
    table === "programs" ? programChain() : failingPurchaseChain(),
  );
});

describe("purchase fail-closed paths", () => {
  it("does not create a request when the client lookup fails", async () => {
    vi.mocked(findClientByTelegramId).mockRejectedValueOnce(
      new Error("db down"),
    );
    const ctx = makeCtx();

    await startPurchase(ctx, randomUUID());

    expect(ctx.reply).toHaveBeenCalled();
    expect(
      (supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> }).from,
    ).not.toHaveBeenCalledWith("purchase_requests");
  });

  it("does not create a request when the pending counter fails", async () => {
    vi.mocked(findClientByTelegramId).mockResolvedValueOnce(null);
    const ctx = makeCtx();

    await startPurchase(ctx, randomUUID());

    expect(ctx.reply).toHaveBeenCalled();
    expect(insertCalls.every((insert) => insert.mock.calls.length === 0)).toBe(
      true,
    );
  });

  it("reports a client lookup error instead of showing the coach request form", async () => {
    vi.mocked(findClientByTelegramId).mockRejectedValueOnce(
      new Error("db down"),
    );
    const ctx = makeCtx();

    await startCoachRequest(ctx);

    expect(ctx.reply).toHaveBeenCalled();
  });
});
