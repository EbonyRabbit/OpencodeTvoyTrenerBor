import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../../lib/supabase-admin.js";
import {
  handleConsentCoachRequest,
  handleSubscribeCancel,
  handleSubscribeConfirm,
  startCoachRequest,
  startProgramChoice,
} from "../subscribe.js";
import { bot } from "../../bot.js";
import type { MyContext } from "../../bot.js";
import { resetDb } from "../../test/integration/db.js";

vi.mock("../../bot.js", () => ({
  bot: { api: { sendMessage: vi.fn().mockResolvedValue({}) } },
}));

const TELEGRAM_ID = 123456789;
const TELEGRAM_ID_EN = 987654321;

function makeCtx(telegramId = TELEGRAM_ID): MyContext {
  return {
    from: {
      id: telegramId,
      username: "buyer",
      first_name: "Иван",
      last_name: "Петров",
    },
    language: "ru",
    reply: vi.fn().mockResolvedValue({}),
    answerCallbackQuery: vi.fn().mockResolvedValue({}),
  } as unknown as MyContext;
}

function markup(ctx: MyContext): {
  inline_keyboard?: { text: string; url?: string; callback_data?: string }[][];
} {
  const options = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as
    | { reply_markup?: unknown }
    | undefined;
  return (options?.reply_markup ?? {}) as {
    inline_keyboard?: { text: string; url?: string; callback_data?: string }[][];
  };
}

const PARSED_CONTENT = {
  version: 1,
  weeks: [
    {
      week_number: 1,
      week_label: "Неделя 1",
      is_deload: false,
      days: [
        {
          day_name: "Пн",
          day_order: 1,
          exercises: [{ name: "Приседания", sets: "3", reps: "10" }],
        },
      ],
    },
    {
      week_number: 2,
      is_deload: false,
      days: [],
    },
  ],
};

async function seedProgram(
  overrides: {
    active?: boolean;
    type?: "template" | "personal";
    clientId?: string | null;
    parsed?: unknown;
    title?: string;
  } = {},
) {
  const { data, error } = await supabaseAdmin
    .from("programs")
    .insert({
      title: overrides.title ?? "Сила Новичка",
      price: 5900,
      duration_weeks: 12,
      active: overrides.active ?? true,
      type: overrides.type ?? "template",
      client_id: overrides.clientId ?? null,
      parsed_content: "parsed" in overrides ? overrides.parsed : PARSED_CONTENT,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("program seed failed");
  return data.id;
}

async function seedClient(overrides: { telegramId?: number } = {}) {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .insert({
      name: "Иван Петров",
      telegram_id: overrides.telegramId ?? TELEGRAM_ID,
      status: "active",
      payment_status: "paid",
      language: "ru",
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("client seed failed");
  return data.id;
}

async function seedSubscription(clientId: string, status = "active") {
  await supabaseAdmin
    .from("subscription_plans")
    .upsert(
      { code: "monthly", title: "Подписка на все программы", price: 4900.0, period_days: 30 },
      { onConflict: "code" },
    );
  const { data: plan } = await supabaseAdmin
    .from("subscription_plans")
    .select("id")
    .eq("code", "monthly")
    .single();
  if (!plan) throw new Error("monthly plan missing");
  const { error } = await supabaseAdmin.from("subscriptions").insert({
    client_id: clientId,
    plan_id: plan.id,
    status,
    current_period_start: "2026-11-01",
    current_period_end: "2026-12-01",
  });
  if (error) throw error;
}

async function requestCount(): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("purchase_requests")
    .select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
});

describe("subscribe flow on real data", () => {
  it("shows a placeholder for a user without a clients row", async () => {
    const programId = await seedProgram();
    const ctx = makeCtx();

    await startProgramChoice(ctx, programId);

    expect(ctx.reply).toHaveBeenCalled();
    expect(markup(ctx).inline_keyboard).toBeUndefined();
  });

  it("shows a placeholder for a client without a live subscription", async () => {
    const programId = await seedProgram();
    await seedClient();
    const ctx = makeCtx();

    await startProgramChoice(ctx, programId);

    expect(ctx.reply).toHaveBeenCalled();
    expect(markup(ctx).inline_keyboard).toBeUndefined();
  });

  it("does not count a cancelled subscription as live access", async () => {
    const programId = await seedProgram();
    const clientId = await seedClient();
    await seedSubscription(clientId, "cancelled");
    const ctx = makeCtx();

    await startProgramChoice(ctx, programId);

    expect(ctx.reply).toHaveBeenCalled();
    expect(markup(ctx).inline_keyboard).toBeUndefined();
  });

  it("offers a confirmation with cancel before switching", async () => {
    const programId = await seedProgram();
    const clientId = await seedClient();
    await seedSubscription(clientId);
    const ctx = makeCtx();

    await startProgramChoice(ctx, programId);

    const buttons = markup(ctx).inline_keyboard?.flat() ?? [];
    expect(buttons.some((b) => b.callback_data === `subscribe_confirm:${programId}`)).toBe(true);
    expect(buttons.some((b) => b.callback_data === "subscribe_cancel")).toBe(true);
    // выбор не меняет периоды до подтверждения
    const { count } = await supabaseAdmin
      .from("client_program_periods")
      .select("id", { count: "exact", head: true });
    expect(count).toBe(0);
  });

  it("switches the period atomically on confirm", async () => {
    const programId = await seedProgram();
    const clientId = await seedClient();
    await seedSubscription(clientId);
    const ctx = makeCtx();

    await startProgramChoice(ctx, programId);
    await handleSubscribeConfirm(ctx, programId);

    const { data: periods, error } = await supabaseAdmin
      .from("client_program_periods")
      .select("*")
      .eq("client_id", clientId);
    expect(error).toBeNull();
    expect(periods).toHaveLength(1);
    expect(periods?.[0]).toMatchObject({
      program_id: programId,
      status: "active",
    });

    const { data: schedule } = await supabaseAdmin
      .from("program_schedule")
      .select("week_number, status, program_id")
      .eq("client_id", clientId);
    expect(schedule).toHaveLength(2);
    expect(schedule?.every((row) => row.program_id === programId && row.status === "active")).toBe(
      true,
    );

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("program_id")
      .eq("id", clientId)
      .single();
    expect(client?.program_id).toBe(programId);
  });

  it("archives the old schedule and closes the old period on re-choice", async () => {
    const firstProgramId = await seedProgram({ title: "Первая" });
    const clientId = await seedClient();
    await seedSubscription(clientId);
    const ctx = makeCtx();

    await startProgramChoice(ctx, firstProgramId);
    await handleSubscribeConfirm(ctx, firstProgramId);

    const secondProgramId = await seedProgram({ title: "Вторая" });
    await startProgramChoice(ctx, secondProgramId);
    await handleSubscribeConfirm(ctx, secondProgramId);

    const { data: periods } = await supabaseAdmin
      .from("client_program_periods")
      .select("status, program_id")
      .eq("client_id", clientId);
    expect(periods).toHaveLength(2);
    expect(periods?.filter((p) => p.program_id === firstProgramId && p.status === "completed"))
      .toHaveLength(1);
    expect(periods?.filter((p) => p.program_id === secondProgramId && p.status === "active"))
      .toHaveLength(1);

    const { data: schedule } = await supabaseAdmin
      .from("program_schedule")
      .select("status, program_id")
      .eq("client_id", clientId);
    expect(schedule?.filter((row) => row.status === "archived")).toHaveLength(2);
    expect(
      schedule?.filter((row) => row.status === "active" && row.program_id === secondProgramId),
    ).toHaveLength(2);
  });

  it("keeps one active period and one reply on a double-tapped confirm", async () => {
    const programId = await seedProgram();
    const clientId = await seedClient();
    await seedSubscription(clientId);
    const first = makeCtx();
    const second = makeCtx();

    await Promise.all([
      handleSubscribeConfirm(first, programId),
      handleSubscribeConfirm(second, programId),
    ]);

    const replies = (first.reply as ReturnType<typeof vi.fn>).mock.calls.length +
      (second.reply as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(replies).toBe(1);

    const { data: periods } = await supabaseAdmin
      .from("client_program_periods")
      .select("status")
      .eq("client_id", clientId);
    expect(periods?.filter((p) => p.status === "active")).toHaveLength(1);
  });

  it("replies in the stored language on confirm", async () => {
    const programId = await seedProgram();
    const clientId = await seedClient({ telegramId: TELEGRAM_ID_EN });
    await supabaseAdmin
      .from("clients")
      .update({ language: "en" })
      .eq("id", clientId);
    await seedSubscription(clientId);
    const ctx = makeCtx(TELEGRAM_ID_EN);

    await handleSubscribeConfirm(ctx, programId);

    const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(replyText).toContain("Done!");
  });

  it("closes pauses when the program is switched", async () => {
    const programId = await seedProgram();
    const clientId = await seedClient();
    await seedSubscription(clientId);
    const { error: pauseError } = await supabaseAdmin.from("plan_pauses").insert({
      client_id: clientId,
      pause_start: "2026-11-01",
      reason: "vacation",
      status: "active",
    });
    if (pauseError) throw pauseError;
    const ctx = makeCtx();

    await startProgramChoice(ctx, programId);
    await handleSubscribeConfirm(ctx, programId);

    const { data: pauses } = await supabaseAdmin
      .from("plan_pauses")
      .select("status")
      .eq("client_id", clientId);
    expect(pauses?.[0].status).toBe("completed");
  });

  it("rejects an unknown program on confirm", async () => {
    const ctx = makeCtx();

    await handleSubscribeConfirm(ctx, randomUUID());

    expect(ctx.reply).toHaveBeenCalled();
    expect(markup(ctx).inline_keyboard).toBeUndefined();
  });

  it("rejects an inactive program", async () => {
    const programId = await seedProgram({ active: false });
    const ctx = makeCtx();

    await startProgramChoice(ctx, programId);

    expect(ctx.reply).toHaveBeenCalled();
  });

  it("rejects a personal program", async () => {
    const clientId = await seedClient();
    const programId = await seedProgram({
      type: "personal",
      clientId,
    });
    const ctx = makeCtx();

    await startProgramChoice(ctx, programId);

    expect(ctx.reply).toHaveBeenCalled();
    // личная программа не даёт confirm-клавиатуры
    expect(markup(ctx).inline_keyboard).toBeUndefined();
  });

  it("fails closed when the program has no parsed weeks", async () => {
    const programId = await seedProgram({ parsed: null });
    const clientId = await seedClient();
    await seedSubscription(clientId);
    const ctx = makeCtx();

    await startProgramChoice(ctx, programId);
    await handleSubscribeConfirm(ctx, programId);

    expect(ctx.reply).toHaveBeenCalled();
    const { count } = await supabaseAdmin
      .from("client_program_periods")
      .select("id", { count: "exact", head: true });
    expect(count).toBe(0);
  });

  it("cancels without touching the schedule", async () => {
    const programId = await seedProgram();
    const clientId = await seedClient();
    await seedSubscription(clientId);
    const ctx = makeCtx();

    await startProgramChoice(ctx, programId);
    await handleSubscribeCancel(ctx);

    const { count } = await supabaseAdmin
      .from("client_program_periods")
      .select("id", { count: "exact", head: true });
    expect(count).toBe(0);
  });

  it("does not create a purchase request through the choice flow", async () => {
    const programId = await seedProgram();
    const clientId = await seedClient();
    await seedSubscription(clientId);
    const ctx = makeCtx();

    await startProgramChoice(ctx, programId);
    await handleSubscribeConfirm(ctx, programId);

    expect(await requestCount()).toBe(0);
  });
});

describe("coach request flow on real data", () => {
  it("requires consent, then creates one coach request and notifies once", async () => {
    const first = makeCtx();
    await startCoachRequest(first);
    expect(await requestCount()).toBe(0);
    expect(markup(first).inline_keyboard?.[0]?.[0]?.callback_data).toBe(
      "coach_request:consent",
    );

    await handleConsentCoachRequest(first);

    let { data, error } = await supabaseAdmin
      .from("purchase_requests")
      .select("id, sub_type, status, consent_given, telegram_id")
      .eq("telegram_id", TELEGRAM_ID);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({
      sub_type: "individ",
      status: "pending",
      consent_given: true,
      telegram_id: TELEGRAM_ID,
    });
    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);

    const second = makeCtx();
    await handleConsentCoachRequest(second);
    ({ data, error } = await supabaseAdmin
      .from("purchase_requests")
      .select("id")
      .eq("telegram_id", TELEGRAM_ID));
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
  });
});
