import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabaseAdmin } from "../../lib/supabase-admin.js";
import { handleWelcome, WELCOME_PARAMS } from "../welcome.js";
import { handleGuideStart, handleGuideInput, handleGuideCallback } from "../guide-calories.js";
import type { MyContext } from "../../bot.js";

vi.mock("../../lib/supabase-admin.js", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("../../state/machine.js", () => ({
  setState: vi.fn().mockResolvedValue(undefined),
  clearState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../chat.js", () => ({
  handleFreeTextMessage: vi.fn().mockResolvedValue(undefined),
  handleCoachIncoming: vi.fn().mockResolvedValue(false),
}));

function makeCtx(overrides: Partial<MyContext> = {} as any): MyContext {
  return {
    from: { id: 555, language_code: "ru" },
    language: "ru" as any,
    reply: vi.fn().mockResolvedValue(undefined),
    replyWithDocument: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    state: null,
    ...overrides,
  } as unknown as MyContext;
}

function mockLogs() {
  const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  fromMock.from.mockImplementation(() => ({
    insert: () => Promise.resolve({ data: null, error: null }),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLogs();
});

describe("guide_calories routing", () => {
  it("WELCOME_PARAMS contains guide_calories", () => {
    expect(WELCOME_PARAMS.has("guide_calories")).toBe(true);
  });

  it("handleWelcome delegates guide_calories to wizard intro", async () => {
    const ctx = makeCtx();
    await handleWelcome(ctx, "guide_calories");
    const sent = (ctx.reply as any).mock.calls[0]?.[0] as string;
    expect(String(sent).toLowerCase()).toContain("калории");
  });

  it("handleGuideStart asks sex and logs guide_calories", async () => {
    const ctx = makeCtx();
    await handleGuideStart(ctx);
    expect(ctx.reply).toHaveBeenCalled();
    expect(supabaseAdmin.from).toHaveBeenCalledWith("bot_logs");
  });

  it("does not swallow commands", async () => {
    const ctx = makeCtx({
      state: { action: "guide_calories", step: "weight", data: {}, telegram_id: 555, created_at: "", updated_at: "" },
      message: { text: "/menu" },
    } as any);
    const handled = await handleGuideInput(ctx);
    expect(handled).toBe(false);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("cancel clears state", async () => {
    const ctx = makeCtx({
      state: { action: "guide_calories", step: "weight", data: {}, telegram_id: 555, created_at: "", updated_at: "" },
      message: { text: "отмена" },
    } as any);
    const handled = await handleGuideInput(ctx);
    expect(handled).toBe(true);
    const { clearState } = await import("../../state/machine.js");
    expect(clearState).toHaveBeenCalled();
  });

  it("broken goal state re-asks sex", async () => {
    const ctx = makeCtx({
      state: { action: "guide_calories", step: "goal", data: {}, telegram_id: 555, created_at: "", updated_at: "" },
      message: { text: "худею" },
    } as any);
    await handleGuideInput(ctx);
    const sent = (ctx.reply as any).mock.calls[0]?.[0] as string;
    expect(String(sent).toLowerCase()).toContain("девушка");
  });

  it("guide:cancel callback clears and replies", async () => {
    const ctx = makeCtx({ state: { action: "guide_calories", step: "sex", data: {} } } as any);
    await handleGuideCallback(ctx, "guide:cancel");
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalled();
  });

  it("guide:start callback opens wizard", async () => {
    const ctx = makeCtx({ state: null } as any);
    await handleGuideCallback(ctx, "guide:start");
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalled();
    const sent = (ctx.reply as any).mock.calls[0]?.[0] as string;
    expect(String(sent).toLowerCase()).toContain("калории");
  });

  it("done + худею routes to cut with program/coach buttons", async () => {
    const ctx = makeCtx({
      state: { action: "guide_calories", step: "done", data: {} },
      message: { text: "я худею к лету" },
    } as any);
    const handled = await handleGuideInput(ctx);
    expect(handled).toBe(true);
    const sent = (ctx.reply as any).mock.calls[0]?.[0] as string;
    expect(String(sent).toLowerCase()).toContain("похудение");
    const kb = JSON.stringify((ctx.reply as any).mock.calls[0]?.[1]?.reply_markup);
    expect(kb).toContain("programs_open");
    expect(kb).toContain("coach_request");
  });

  it("done + набираю routes to bulk", async () => {
    const ctx = makeCtx({
      state: { action: "guide_calories", step: "done", data: {} },
      message: { text: "хочу набрать массу" },
    } as any);
    await handleGuideInput(ctx);
    const sent = (ctx.reply as any).mock.calls[0]?.[0] as string;
    expect(String(sent).toLowerCase()).toContain("набор");
  });

  it("done + мусор routes to other and forwards to coach", async () => {
    const { handleFreeTextMessage } = await import("../chat.js");
    const ctx = makeCtx({
      state: { action: "guide_calories", step: "done", data: {} },
      message: { text: "привет а это точно работает" },
    } as any);
    await handleGuideInput(ctx);
    const sent = (ctx.reply as any).mock.calls[0]?.[0] as string;
    expect(String(sent).toLowerCase()).toContain("регулярность");
    expect(handleFreeTextMessage).toHaveBeenCalled();
  });
});
