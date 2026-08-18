import { describe, it, expect, vi, beforeEach } from "vitest";
import { startHandler } from "../start.js";
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
    message: { text: "/start" },
    language: "ru",
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as MyContext;
}

function mockNoClient() {
  const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  fake.from.mockImplementation((table: string) => {
    if (table === "clients") {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
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

describe("startHandler (new user)", () => {
  it("offers programs and the coach_request button to a brand-new user", async () => {
    mockNoClient();
    const ctx = makeCtx();

    await startHandler(ctx);

    const options = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      reply_markup?: unknown;
    };
    const keyboard = JSON.stringify(options.reply_markup ?? []);
    expect(keyboard).toContain("programs_open");
    expect(keyboard).toContain("coach_request");
  });
});