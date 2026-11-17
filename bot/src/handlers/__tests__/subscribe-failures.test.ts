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
import { startCoachRequest, startProgramChoice } from "../subscribe.js";
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
      data: { id: randomUUID(), title: "Сила", parsed_content: null },
      error: null,
    })),
  };
  return chain;
}

function subscriptionChain(error: { message: string } | null) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data: null, error })),
  };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  const from = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  from.from.mockImplementation((table: string) =>
    table === "programs"
      ? programChain()
      : table === "subscriptions"
        ? subscriptionChain(null)
        : (() => {
            throw new Error(`Unexpected table: ${table}`);
          })(),
  );
});

describe("subscribe fail-closed paths", () => {
  it("does not check subscriptions when the client lookup fails", async () => {
    vi.mocked(findClientByTelegramId).mockRejectedValueOnce(
      new Error("db down"),
    );
    const ctx = makeCtx();

    await startProgramChoice(ctx, randomUUID());

    expect(ctx.reply).toHaveBeenCalled();
    expect(
      (supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> }).from,
    ).not.toHaveBeenCalledWith("subscriptions");
  });

  it("replies with an error when the subscription check fails", async () => {
    vi.mocked(findClientByTelegramId).mockResolvedValueOnce({
      id: "c-1",
      language: "ru",
    } as unknown as Awaited<ReturnType<typeof findClientByTelegramId>>);
    const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    fake.from.mockImplementation((table: string) =>
      table === "programs"
        ? programChain()
        : subscriptionChain({ message: "count failed" }),
    );
    const ctx = makeCtx();

    await startProgramChoice(ctx, randomUUID());

    expect(ctx.reply).toHaveBeenCalled();
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
