import { describe, it, expect, vi, beforeEach } from "vitest";
import { menuHandler } from "../menu.js";
import { supabaseAdmin } from "../../lib/supabase-admin.js";
import type { MyContext } from "../../bot.js";

vi.mock("../../config.js", () => ({
  config: {
    telegram: { botToken: "test", webhookSecret: "test" },
    supabase: { url: "http://localhost:54321", serviceRoleKey: "test" },
    coachChatId: 0n,
    nodeEnv: "test",
    port: 3001,
    webhookPath: "/webhook",
    publicUrl: "",
  },
}));

vi.mock("../../lib/supabase-admin.js", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

function makeCtx() {
  return {
    from: { id: 123456789, username: "buyer" },
    language: "ru",
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as MyContext;
}

function mockActiveClient() {
  const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  fake.from.mockImplementation((table: string) => {
    if (table === "clients") {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () =>
          Promise.resolve({
            data: {
              id: "c-1",
              telegram_id: 123456789,
              name: "Иван",
              status: "active",
              payment_status: "paid",
              program_id: "prog-1",
              purchased_program_id: null,
              language: "ru",
              client_consent_given: true,
            },
            error: null,
          }),
      };
      return chain;
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  return fake.from;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("menuHandler", () => {
  it("shows the coach_request button in the active client menu", async () => {
    mockActiveClient();
    const ctx = makeCtx();

    await menuHandler(ctx);

    const text = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(text).toContain("Доступные команды:");
    const options = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      reply_markup?: unknown;
    };
    expect(JSON.stringify(options.reply_markup)).toContain("coach_request");
  });
});