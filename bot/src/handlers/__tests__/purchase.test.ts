import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { supabaseAdmin } from "../../lib/supabase-admin.js";
import { config } from "../../config.js";
import { startPurchase, handleConsentPurchase, buildPurchaseCoachMessage } from "../purchase.js";
import { buildPaymentUrl } from "../../lib/prodamus.js";
import type { MyContext } from "../../bot.js";

vi.mock("../../config.js", () => ({
  config: {
    telegram: { botToken: "test", webhookSecret: "test" },
    supabase: { url: "http://localhost:54321", serviceRoleKey: "test" },
    coachChatId: 0n,
    paymentBaseUrl: "",
    prodamusPayformBaseUrl: "https://pay.demo.prodamus.ru/payment",
    clientPortalUrl: "https://portal.example.com",
    nodeEnv: "test",
    port: 3001,
    webhookPath: "/webhook",
    publicUrl: "",
  },
}));

vi.mock("../../lib/supabase-admin.js", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

type QueryCall = { method: string; args: unknown[] };
type Row = { data: unknown; error: null };
type Handler = (calls: QueryCall[], terminal: string) => Row;

const captured: Record<string, QueryCall[]> = {};

function mockDb(handlers: Record<string, Handler>) {
  const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  fromMock.from.mockImplementation((table: string) => {
    const calls: QueryCall[] = [];
    captured[table] = calls;
    const record = (method: string, args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
    const resolve = (terminal: string) =>
      Promise.resolve(handlers[table](calls, terminal));
    const chain = {
      select: (...args: unknown[]) => record("select", args),
      eq: (...args: unknown[]) => record("eq", args),
      is: (...args: unknown[]) => record("is", args),
      order: (...args: unknown[]) => record("order", args),
      limit: (...args: unknown[]) => record("limit", args),
      insert: (...args: unknown[]) => record("insert", args),
      update: (...args: unknown[]) => record("update", args),
      maybeSingle: () => resolve("maybeSingle"),
      single: () => resolve("single"),
      then: (onFulfilled: (v: unknown) => unknown) => resolve("then").then(onFulfilled),
    };
    return chain;
  });
  return fromMock.from;
}

function callsFor(table: string): QueryCall[] {
  return captured[table] ?? [];
}

const BUYABLE_PROGRAM = { id: "prog-1", title: "Сила Новичка 12 недель", price: 9900 };

const ok = (data: unknown): Row => ({ data, error: null });

function makeCtx(overrides: Partial<MyContext> = {}) {
  return {
    from: { id: 123456789, username: "buyer", first_name: "Иван", last_name: "Петров" },
    language: "ru",
    reply: vi.fn().mockResolvedValue({}),
    answerCallbackQuery: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as MyContext;
}

function replyOptions(ctx: MyContext): Record<string, unknown> {
  return (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][1] ?? {};
}

function keyboardJson(options: Record<string, unknown>): string {
  return JSON.stringify(options.reply_markup ?? []);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  (config as { coachChatId: bigint }).coachChatId = 0n;
});

describe("buildPurchaseCoachMessage", () => {
  it("includes name, username link, program and price", () => {
    const msg = buildPurchaseCoachMessage({
      firstName: "Иван",
      lastName: "Петров",
      username: "buyer",
      telegramId: 123456789,
      programTitle: "Сила Новичка",
      price: 9900,
    });
    expect(msg).toContain("🛒 Заявка на покупку");
    expect(msg).toContain("Программа: Сила Новичка");
    expect(msg).toContain(`Цена: 9\u00A0900 ₽`);
    expect(msg).toContain("👤 Иван Петров");
    expect(msg).toContain("🔗 @buyer (https://t.me/buyer)");
    expect(msg).toContain("🆔 TG ID: 123456789");
  });

  it("handles missing username and last name", () => {
    const msg = buildPurchaseCoachMessage({
      firstName: "Иван",
      lastName: null,
      username: null,
      telegramId: 123456789,
      programTitle: "Сила Новичка",
      price: 9900,
    });
    expect(msg).toContain("👤 Иван");
    expect(msg).not.toContain("@");
    expect(msg).toContain("🆔 TG ID: 123456789");
  });

  it("omits price line when price is null", () => {
    const msg = buildPurchaseCoachMessage({
      firstName: "Иван",
      lastName: null,
      username: null,
      telegramId: 1,
      programTitle: "P",
      price: null,
    });
    expect(msg).not.toContain("Цена:");
  });
});

describe("startPurchase", () => {
  it("rejects malformed program id with an alert", async () => {
    mockDb({});
    const ctx = makeCtx();

    await startPurchase(ctx, "not-a-uuid");

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: "Неизвестное действие. Обновите меню.",
      show_alert: true,
    });
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("shows not_found when no buyable program matches", async () => {
    mockDb({ programs: () => ok(null) });
    const ctx = makeCtx();

    await startPurchase(ctx, "11111111-1111-1111-1111-111111111111");

    expect(ctx.reply).toHaveBeenCalledWith(
      "Программа недоступна для покупки. Свяжитесь с тренером.",
    );
  });

  it("rejects zero-price and null-price programs", async () => {
    for (const price of [0, null]) {
      mockDb({ programs: () => ok({ ...BUYABLE_PROGRAM, price }) });
      const ctx = makeCtx();
      await startPurchase(ctx, "11111111-1111-1111-1111-111111111111");
      expect(ctx.reply).toHaveBeenCalledWith(
        "Программа недоступна для покупки. Свяжитесь с тренером.",
      );
    }
  });

  it("creates a request and shows the consent step", async () => {
    mockDb({
      programs: () => ok(BUYABLE_PROGRAM),
      clients: () => ok(null),
      bot_logs: () => ok(null),
      purchase_requests: (_calls, terminal) => {
        if (terminal === "single") return ok({ id: "req-1" });
        return ok(null);
      },
    });
    const ctx = makeCtx();

    await startPurchase(ctx, "11111111-1111-1111-1111-111111111111");

    const insert = callsFor("purchase_requests").find((c) => c.method === "insert");
    expect(insert).toBeDefined();
    expect(insert?.args[0]).toMatchObject({
      program_id: "prog-1",
      name: "Иван Петров",
      contact: "@buyer",
      telegram_id: 123456789,
      first_name: "Иван",
      last_name: "Петров",
      sub_type: "program",
    });

    const text = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(text).toContain("Согласие на обработку данных");
    expect(text).toContain("«Сила Новичка 12 недель»");
    expect(text).toContain(`9\u00A0900 ₽`);
    expect(text).toContain("portal.example.com");
    expect(keyboardJson(replyOptions(ctx))).toContain("consent_purchase:req-1");
  });

  it("reuses a pending request without consent and re-shows the consent step", async () => {
    mockDb({
      programs: () => ok(BUYABLE_PROGRAM),
      clients: () => ok(null),
      purchase_requests: () => ok({ id: "req-1", consent_given: false }),
    });
    const ctx = makeCtx();

    await startPurchase(ctx, "11111111-1111-1111-1111-111111111111");

    expect(callsFor("purchase_requests").some((c) => c.method === "insert")).toBe(false);
    expect(keyboardJson(replyOptions(ctx))).toContain("consent_purchase:req-1");
  });

  it("reuses a consented pending request and sends the payment link directly", async () => {
    mockDb({
      programs: () => ok(BUYABLE_PROGRAM),
      clients: () => ok(null),
      purchase_requests: () => ok({ id: "req-1", consent_given: true }),
    });
    const ctx = makeCtx();

    await startPurchase(ctx, "11111111-1111-1111-1111-111111111111");

    expect(callsFor("purchase_requests").some((c) => c.method === "insert")).toBe(false);
    const buttons = keyboardJson(replyOptions(ctx));
    expect(buttons).toContain(
      `"url":"https://pay.demo.prodamus.ru/payment?do=pay&order_id=req-1`,
    );
    expect(buttons).toContain("%5B0%5D%5Bprice%5D=9900.00");
  });
});

describe("handleConsentPurchase", () => {
  const REQUEST_ID = "11111111-1111-1111-1111-111111111111";

  it("rejects malformed request id", async () => {
    mockDb({});
    const ctx = makeCtx();

    await handleConsentPurchase(ctx, "nope");

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: "Неизвестное действие. Обновите меню.",
      show_alert: true,
    });
  });

  it("refuses to consent for someone else's request", async () => {
    mockDb({
      purchase_requests: () =>
        ok({
          id: "req-1",
          program_id: "prog-1",
          status: "pending",
          consent_given: false,
          sub_type: "program",
          telegram_id: 999,
        }),
    });
    const ctx = makeCtx();

    await handleConsentPurchase(ctx, REQUEST_ID);

    expect(ctx.reply).toHaveBeenCalledWith(
      "Заявка не найдена. Начните покупку заново через /programs.",
    );
    expect(callsFor("purchase_requests").some((c) => c.method === "update")).toBe(false);
  });

  it("warns when the request is already paid", async () => {
    mockDb({
      purchase_requests: () =>
        ok({
          id: "req-1",
          program_id: "prog-1",
          status: "paid",
          consent_given: true,
          sub_type: "program",
          telegram_id: 123456789,
        }),
    });
    const ctx = makeCtx();

    await handleConsentPurchase(ctx, REQUEST_ID);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Заявка уже оплачена"));
  });

  it("records consent with version and sends a payment link", async () => {
    const updates: Record<string, unknown>[] = [];
    mockDb({
      purchase_requests: (calls, terminal) => {
        const updateCall = calls.find((c) => c.method === "update");
        if (updateCall) updates.push(updateCall.args[0] as Record<string, unknown>);
        if (terminal === "then") return ok([]);
        if (updateCall) return ok(null);
        return ok({
          id: "req-1",
          program_id: "prog-1",
          status: "pending",
          consent_given: false,
          sub_type: "program",
          telegram_id: 123456789,
        });
      },
      programs: () => ok(BUYABLE_PROGRAM),
    });
    const ctx = makeCtx();

    await handleConsentPurchase(ctx, REQUEST_ID);

    expect(updates).toHaveLength(1);
    expect(updates[0].consent_given).toBe(true);
    expect(updates[0].consent_version).toBe("2026-07-16");
    expect(updates[0].consent_at).toEqual(expect.any(String));

    const text = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(text).toContain("Спасибо! Согласие принято.");
    const buttons = keyboardJson(replyOptions(ctx));
    expect(buttons).toContain(
      `"url":"https://pay.demo.prodamus.ru/payment?do=pay&order_id=${REQUEST_ID}`,
    );
  });

  it("does not re-record consent when already given", async () => {
    const updates: Record<string, unknown>[] = [];
    mockDb({
      purchase_requests: (calls, terminal) => {
        const updateCall = calls.find((c) => c.method === "update");
        if (updateCall) updates.push(updateCall.args[0] as Record<string, unknown>);
        if (terminal === "then") return ok([]);
        if (updateCall) return ok(null);
        return ok({
          id: "req-1",
          program_id: "prog-1",
          status: "pending",
          consent_given: true,
          sub_type: "program",
          telegram_id: 123456789,
        });
      },
      programs: () => ok(BUYABLE_PROGRAM),
    });
    const ctx = makeCtx();

    await handleConsentPurchase(ctx, REQUEST_ID);

    expect(updates).toHaveLength(0);
    expect(keyboardJson(replyOptions(ctx))).toContain(`order_id=${REQUEST_ID}`);
  });
});

describe("buildPaymentUrl (bot copy)", () => {
  it("produces a payform URL with order_id and product", () => {
    const url = buildPaymentUrl({
      payformUrl: "https://pay.demo.prodamus.ru/payment",
      orderId: "req-1",
      amount: 9900,
      productName: "Сила Новичка 12 недель",
    });
    expect(url).toContain("do=pay");
    expect(url).toContain("order_id=req-1");
    expect(url).toContain("products%5B0%5D%5Bname%5D=");
    expect(url).toContain("products%5B0%5D%5Bprice%5D=9900.00");
    expect(url).toContain("products%5B0%5D%5Bquantity%5D=1");
  });

  it("rejects non-positive amounts", () => {
    expect(() =>
      buildPaymentUrl({
        payformUrl: "https://pay.demo.prodamus.ru/payment",
        orderId: "req-1",
        amount: 0,
        productName: "Программа",
      }),
    ).toThrow("Invalid amount");
  });
});