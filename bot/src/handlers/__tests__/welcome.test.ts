import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabaseAdmin } from "../../lib/supabase-admin.js";
import { handleWelcome, handleWelcomeCallback, WELCOME_PARAMS } from "../welcome.js";
import type { MyContext } from "../../bot.js";

vi.mock("../../lib/supabase-admin.js", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

function makeCtx(overrides: Partial<MyContext> = {} as any): MyContext {
  return {
    from: { id: 123, language_code: "ru" },
    language: "ru" as any,
    reply: vi.fn().mockResolvedValue(undefined),
    replyWithDocument: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as MyContext;
}

let lastInsert: any = null;
function mockLogs() {
  const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  fromMock.from.mockImplementation(() => {
    const chain: any = {
      insert: (row: any) => {
        lastInsert = row;
        return Promise.resolve({ data: null, error: null });
      },
    };
    return chain;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  lastInsert = null;
  mockLogs();
});

describe("WELCOME_PARAMS", () => {
  it("contains channel_grow and zir_inst", () => {
    expect(WELCOME_PARAMS.has("channel_grow")).toBe(true);
    expect(WELCOME_PARAMS.has("zir_inst")).toBe(true);
    expect(WELCOME_PARAMS.has("unknown")).toBe(false);
  });
});

describe("handleWelcome", () => {
  it("sends zir_inst personal text and logs", async () => {
    const ctx = makeCtx();
    await handleWelcome(ctx, "ZIR_inst");
    const docCall = (ctx.replyWithDocument as any).mock.calls[0];
    const fallbackCall = (ctx.reply as any).mock.calls[0];
    const sent = docCall ? docCall[1]?.caption ?? docCall[0] : fallbackCall?.[0];
    expect(String(sent)).toContain("ЖИР");
    expect(supabaseAdmin.from).toHaveBeenCalledWith("bot_logs");
  });

  it("sends channel_grow general text", async () => {
    const ctx = makeCtx();
    await handleWelcome(ctx, "channel_grow");
    const docCall = (ctx.replyWithDocument as any).mock.calls[0];
    const fallbackCall = (ctx.reply as any).mock.calls[0];
    const sent = docCall ? docCall[1]?.caption ?? "" : fallbackCall?.[0] ?? "";
    expect(String(sent).toLowerCase()).toContain("канал");
    const kb = docCall ? docCall[1]?.reply_markup : fallbackCall?.[1]?.reply_markup;
    expect(JSON.stringify(kb)).toContain("welcome:plan");
    expect(JSON.stringify(kb)).toContain("welcome:browse");
  });

  it("handles case-insensitive param", async () => {
    const ctx = makeCtx();
    await handleWelcome(ctx, "CHANNEL_GROW");
    expect(ctx.replyWithDocument).toHaveBeenCalledTimes(1);
  });

  it("does not throw when telegram_id missing", async () => {
    const ctx = makeCtx({ from: undefined } as any);
    await expect(handleWelcome(ctx, "channel_grow")).resolves.toBeUndefined();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("logs with trimmed details slice", async () => {
    const ctx = makeCtx();
    await handleWelcome(ctx, "  channel_grow  ");
    expect(lastInsert).toMatchObject({ action: "welcome_sent", details: "channel_grow", telegram_id: 123 });
  });

  it("truncates details to 64 chars", async () => {
    const ctx = makeCtx();
    const long = "a".repeat(100);
    await handleWelcome(ctx, long);
    expect(String(lastInsert.details).length).toBe(64);
  });
});

describe("handleWelcomeCallback", () => {
  it("answers callback and replies plan hint", async () => {
    const ctx = makeCtx();
    await handleWelcomeCallback(ctx, "welcome:plan");
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("/programs"));
  });

  it("answers callback and replies browse hint", async () => {
    const ctx = makeCtx();
    await handleWelcomeCallback(ctx, "welcome:browse");
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalled();
  });
});
