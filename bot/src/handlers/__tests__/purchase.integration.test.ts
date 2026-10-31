import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../../lib/supabase-admin.js";
import {
  handleConsentCoachRequest,
  handleConsentPurchase,
  resendPaymentLink,
  startCoachRequest,
  startPurchase,
} from "../purchase.js";
import { bot } from "../../bot.js";
import { resolvePaymentUrl } from "../../lib/prodamus.js";
import { config } from "../../config.js";
import type { MyContext } from "../../bot.js";
import { resetDb } from "../../test/integration/db.js";

vi.mock("../../bot.js", () => ({
  bot: { api: { sendMessage: vi.fn().mockResolvedValue({}) } },
}));

vi.mock("../../lib/prodamus.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/prodamus.js")>();
  return {
    ...actual,
    resolvePaymentUrl: vi.fn(actual.buildPaymentUrl),
  };
});

const TELEGRAM_ID = 123456789;

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

async function seedProgram(
  price = 5900,
  overrides: {
    active?: boolean;
    type?: "template" | "individual";
    clientId?: string | null;
  } = {},
) {
  const { data, error } = await supabaseAdmin
    .from("programs")
    .insert({
      title: "Сила Новичка",
      price,
      duration_weeks: 12,
      active: overrides.active ?? true,
      type: overrides.type ?? "template",
      client_id: overrides.clientId ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("program seed failed");
  return data.id;
}

async function seedRequest({
  programId,
  status = "pending",
  consent = false,
  amount = 5900,
  telegramId = TELEGRAM_ID,
  subType = "program",
  clientId = null,
  createdAt,
}: {
  programId: string;
  status?: "pending" | "paid" | "cancelled";
  consent?: boolean;
  amount?: number | null;
  telegramId?: number;
  subType?: "program" | "individ";
  clientId?: string | null;
  createdAt?: string;
}) {
  const id = randomUUID();
  const { error } = await supabaseAdmin.from("purchase_requests").insert({
    id,
    order_id: id,
    program_id: programId,
    telegram_id: telegramId,
    name: "Иван Петров",
    contact: "@buyer",
    first_name: "Иван",
    last_name: "Петров",
    sub_type: subType,
    status,
    amount,
    consent_given: consent,
    client_id: clientId,
    ...(createdAt ? { created_at: createdAt } : {}),
  });
  if (error) throw error;
  return id;
}

async function requestRow(id: string) {
  const { data, error } = await supabaseAdmin
    .from("purchase_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
});

async function requestCount(): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("purchase_requests")
    .select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

describe("purchase flow on real data", () => {
  it("creates one request for a double tap and snapshots the price", async () => {
    const programId = await seedProgram();
    const first = makeCtx();
    const second = makeCtx();

    await Promise.all([
      startPurchase(first, programId),
      startPurchase(second, programId),
    ]);

    const { data: rows, error } = await supabaseAdmin
      .from("purchase_requests")
      .select("*")
      .eq("telegram_id", TELEGRAM_ID)
      .eq("program_id", programId);
    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({
      program_id: programId,
      telegram_id: TELEGRAM_ID,
      name: "Иван Петров",
      contact: "@buyer",
      sub_type: "program",
      status: "pending",
      consent_given: false,
      amount: 5900,
    });
    expect(rows?.[0].order_id).toBe(rows?.[0].id);
  });

  it("reuses a pending request and quotes its stored amount", async () => {
    const programId = await seedProgram(5900);
    const requestId = await seedRequest({
      programId,
      consent: true,
      amount: 4900,
    });
    const ctx = makeCtx();

    await startPurchase(ctx, programId);

    const { count } = await supabaseAdmin
      .from("purchase_requests")
      .select("id", { count: "exact", head: true })
      .eq("telegram_id", TELEGRAM_ID);
    expect(count).toBe(1);

    expect(resolvePaymentUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: requestId,
        amount: 4900,
        productName: "Сила Новичка",
      }),
    );
    const button = markup(ctx).inline_keyboard?.[0]?.[0];
    expect(button?.url).toBeTruthy();
  });

  it("records consent once and sends a payment link", async () => {
    const programId = await seedProgram();
    const requestId = await seedRequest({ programId });
    const ctx = makeCtx();

    await handleConsentPurchase(ctx, requestId);

    const row = await requestRow(requestId);
    expect(row).toMatchObject({
      status: "pending",
      consent_given: true,
    });
    expect(row?.consent_at).toBeTruthy();
    expect(row?.consent_version).toBeTruthy();

    expect(resolvePaymentUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: requestId,
        amount: 5900,
        productName: "Сила Новичка",
      }),
    );
    const button = markup(ctx).inline_keyboard?.[0]?.[0];
    expect(button?.url).toBeTruthy();
  });

  it("sends one payment link when a pending purchase is started twice", async () => {
    const programId = await seedProgram();
    await seedRequest({ programId, consent: true });
    const first = makeCtx();
    const second = makeCtx();

    await Promise.all([
      startPurchase(first, programId),
      startPurchase(second, programId),
    ]);

    const links = [first, second].filter((ctx) => {
      const button = markup(ctx).inline_keyboard?.[0]?.[0];
      return Boolean(button?.url);
    });
    expect(links).toHaveLength(1);
    expect(resolvePaymentUrl).toHaveBeenCalledTimes(1);
  });

  it("does not resend a payment link when the UTC date changes", async () => {
    const programId = await seedProgram();
    await seedRequest({ programId, consent: true });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.setSystemTime(new Date("2026-10-28T23:59:30.000Z"));
      const first = makeCtx();
      await startPurchase(first, programId);
      expect(markup(first).inline_keyboard?.[0]?.[0]?.url).toBeTruthy();

      vi.setSystemTime(new Date("2026-10-29T00:00:30.000Z"));
      const second = makeCtx();
      await startPurchase(second, programId);

      expect(markup(second).inline_keyboard?.[0]?.[0]?.url ?? null).toBeNull();
      expect(resolvePaymentUrl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resends a payment link on explicit request", async () => {
    const programId = await seedProgram();
    const requestId = await seedRequest({ programId, consent: true });
    const first = makeCtx();
    await startPurchase(first, programId);
    const second = makeCtx();
    await startPurchase(second, programId);

    const duplicate = (
      second.reply as ReturnType<typeof vi.fn>
    ).mock.calls.at(-1)?.[1] as {
      reply_markup?: {
        inline_keyboard?: { callback_data?: string }[][];
      };
    };
    expect(
      duplicate.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data,
    ).toBe(`resend_payment_link:${requestId}`);

    (second.reply as ReturnType<typeof vi.fn>).mockClear();
    await resendPaymentLink(second, requestId);

    const options = (second.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as
      | { reply_markup?: { inline_keyboard?: { url?: string }[][] } }
      | undefined;
    expect(
      options?.reply_markup?.inline_keyboard?.[0]?.[0]?.url,
    ).toBeTruthy();
    expect(resolvePaymentUrl).toHaveBeenCalledTimes(2);
  });

  it("creates one link when resend is double-tapped", async () => {
    const programId = await seedProgram();
    const requestId = await seedRequest({ programId, consent: true });
    const first = makeCtx();
    await startPurchase(first, programId);
    const second = makeCtx();
    const third = makeCtx();

    await Promise.all([
      resendPaymentLink(second, requestId),
      resendPaymentLink(third, requestId),
    ]);

    const links = [second, third].filter((ctx) => {
      const button = markup(ctx).inline_keyboard?.[0]?.[0];
      return Boolean(button?.url);
    });
    expect(links).toHaveLength(1);
    expect(resolvePaymentUrl).toHaveBeenCalledTimes(2);
  });

  it("retries a payment link after a transient send failure", async () => {
    const programId = await seedProgram();
    await seedRequest({ programId, consent: true });
    vi.mocked(resolvePaymentUrl).mockRejectedValueOnce(new Error("network"));
    const first = makeCtx();
    const second = makeCtx();

    await startPurchase(first, programId);
    expect(
      (markup(first).inline_keyboard?.[0]?.[0]?.url ?? null),
    ).toBeNull();

    await startPurchase(second, programId);
    expect(markup(second).inline_keyboard?.[0]?.[0]?.url).toBeTruthy();
  });

  it("sends one payment link when consent is double-tapped", async () => {
    const programId = await seedProgram();
    const requestId = await seedRequest({ programId });
    const first = makeCtx();
    const second = makeCtx();

    await Promise.all([
      handleConsentPurchase(first, requestId),
      handleConsentPurchase(second, requestId),
    ]);

    const links = [first, second].filter((ctx) => {
      const button = markup(ctx).inline_keyboard?.[0]?.[0];
      return Boolean(button?.url);
    });
    expect(links).toHaveLength(1);
    expect(resolvePaymentUrl).toHaveBeenCalledTimes(1);
    expect((await requestRow(requestId))?.consent_given).toBe(true);
  });

  it("does not send a second payment link when the program is already paid", async () => {
    const programId = await seedProgram();
    await seedRequest({ programId, status: "paid", consent: true });
    const pendingId = await seedRequest({ programId });
    const ctx = makeCtx();

    await handleConsentPurchase(ctx, pendingId);

    expect(markup(ctx).inline_keyboard).toBeUndefined();
    expect(ctx.reply).toHaveBeenCalled();
    const row = await requestRow(pendingId);
    expect(row?.status).toBe("pending");
  });

  it("does not revive a cancelled request", async () => {
    const programId = await seedProgram();
    const requestId = await seedRequest({
      programId,
      status: "cancelled",
    });
    const ctx = makeCtx();

    await handleConsentPurchase(ctx, requestId);

    expect(markup(ctx).inline_keyboard).toBeUndefined();
    const row = await requestRow(requestId);
    expect(row).toMatchObject({
      status: "cancelled",
      consent_given: false,
    });
  });

  it("blocks a purchase of a program the client already owns", async () => {
    const programId = await seedProgram();
    const { error } = await supabaseAdmin.from("clients").insert({
      name: "Иван Петров",
      telegram_id: TELEGRAM_ID,
      program_id: programId,
    });
    if (error) throw error;
    const ctx = makeCtx();

    await startPurchase(ctx, programId);

    expect(ctx.reply).toHaveBeenCalled();
    expect(markup(ctx).inline_keyboard).toBeUndefined();
    expect(await requestCount()).toBe(0);
  });

  it("does not revive a paid request", async () => {
    const programId = await seedProgram();
    await seedRequest({ programId, status: "paid", consent: true });
    const ctx = makeCtx();

    await startPurchase(ctx, programId);

    expect(markup(ctx).inline_keyboard).toBeUndefined();
    expect(ctx.reply).toHaveBeenCalled();
    expect(await requestCount()).toBe(1);
  });

  it("allows a new request after a coach cancelled the previous one", async () => {
    const programId = await seedProgram();
    await seedRequest({ programId, status: "cancelled" });
    const ctx = makeCtx();

    await startPurchase(ctx, programId);

    expect(await requestCount()).toBe(2);
    const { data } = await supabaseAdmin
      .from("purchase_requests")
      .select("status")
      .eq("telegram_id", TELEGRAM_ID)
      .eq("program_id", programId)
      .eq("status", "pending");
    expect(data).toHaveLength(1);
  });

  it("blocks a new request when the pending limit is reached", async () => {
    const targetProgramId = await seedProgram();
    for (let i = 0; i < 3; i++) {
      const programId = await seedProgram(1000 + i);
      await seedRequest({ programId });
    }
    const ctx = makeCtx();

    await startPurchase(ctx, targetProgramId);

    expect(ctx.reply).toHaveBeenCalled();
    expect(markup(ctx).inline_keyboard).toBeUndefined();
    expect(await requestCount()).toBe(3);
  });

  it("rejects unknown and inactive programs", async () => {
    const inactiveProgramId = await seedProgram(5900, { active: false });
    const inactiveCtx = makeCtx();
    await startPurchase(inactiveCtx, inactiveProgramId);
    expect(inactiveCtx.reply).toHaveBeenCalled();
    expect(await requestCount()).toBe(0);

    const missingCtx = makeCtx();
    await startPurchase(missingCtx, randomUUID());
    expect(missingCtx.reply).toHaveBeenCalled();
    expect(await requestCount()).toBe(0);
  });

  it("rejects an invalid program id without touching the database", async () => {
    const ctx = makeCtx();

    await startPurchase(ctx, "not-a-uuid");

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ show_alert: true }),
    );
    expect(await requestCount()).toBe(0);
  });

  it("does not let another Telegram user confirm someone else's request", async () => {
    const programId = await seedProgram();
    const requestId = await seedRequest({
      programId,
      telegramId: 999999,
    });
    const ctx = makeCtx();

    await handleConsentPurchase(ctx, requestId);

    const row = await requestRow(requestId);
    expect(row).toMatchObject({ status: "pending", consent_given: false });
    expect(markup(ctx).inline_keyboard).toBeUndefined();
    expect(resolvePaymentUrl).not.toHaveBeenCalled();
  });

  it("does not confirm a non-program request through the purchase button", async () => {
    const programId = await seedProgram();
    const requestId = await seedRequest({
      programId,
      subType: "individ",
    });
    const ctx = makeCtx();

    await handleConsentPurchase(ctx, requestId);

    const row = await requestRow(requestId);
    expect(row).toMatchObject({ status: "pending", consent_given: false });
    expect(resolvePaymentUrl).not.toHaveBeenCalled();
  });

  it("notifies the coach once and records the request in bot_logs", async () => {
    const programId = await seedProgram();
    const ctx = makeCtx();

    await startPurchase(ctx, programId);

    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
    const { data, error } = await supabaseAdmin
      .from("bot_logs")
      .select("action, details")
      .eq("telegram_id", TELEGRAM_ID);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0].action).toBe("purchase_request");
    expect(data?.[0].details).toContain(programId);
  });

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
  it("rejects a zero-price program without creating a request", async () => {
    const programId = await seedProgram(0);
    const ctx = makeCtx();

    await startPurchase(ctx, programId);

    expect(ctx.reply).toHaveBeenCalled();
    expect(await requestCount()).toBe(0);
  });

  it("shows a payment-unavailable message when payform is not configured", async () => {
    const programId = await seedProgram();
    const requestId = await seedRequest({ programId });
    const ctx = makeCtx();
    const original = config.prodamusPayformBaseUrl;
    (config as { prodamusPayformBaseUrl: string }).prodamusPayformBaseUrl = "";
    try {
      await handleConsentPurchase(ctx, requestId);
    } finally {
      (config as { prodamusPayformBaseUrl: string }).prodamusPayformBaseUrl =
        original;
    }

    expect(ctx.reply).toHaveBeenCalled();
    expect(markup(ctx).inline_keyboard).toBeUndefined();
    expect(resolvePaymentUrl).not.toHaveBeenCalled();
    expect((await requestRow(requestId))?.consent_given).toBe(true);
  });

});
