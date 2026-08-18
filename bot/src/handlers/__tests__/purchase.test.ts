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
type Row = { data: unknown; error: unknown; count?: number };
type Handler = (calls: QueryCall[], terminal: string) => Row;

const captured: Record<string, QueryCall[]> = {};

function mockDb(handlers: Record<string, Handler>) {
  const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  fromMock.from.mockImplementation((table: string) => {
    const calls: QueryCall[] = [];
    const record = (method: string, args: unknown[]) => {
      calls.push({ method, args });
      captured[table] = [...(captured[table] ?? []), { method, args }];
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
const VALID_PROGRAM_ID = "11111111-1111-1111-1111-111111111111";
const REQUEST_ID = "22222222-2222-2222-2222-222222222222";

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

function replyText(ctx: MyContext, index = 0): string {
  return (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[index][0] as string;
}

function replyOptions(ctx: MyContext): Record<string, unknown> {
  return (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][1] ?? {};
}

function keyboardJson(options: Record<string, unknown>): string {
  return JSON.stringify(options.reply_markup ?? []);
}

function firstReplyText(ctx: MyContext): string {
  return replyText(ctx, 0);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(captured)) delete captured[key];
});

afterEach(() => {
  (config as { coachChatId: bigint }).coachChatId = 0n;
  (config as { prodamusPayformBaseUrl: string }).prodamusPayformBaseUrl =
    "https://pay.demo.prodamus.ru/payment";
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
  function defaultDb(latest: unknown = null, count = 0) {
    mockDb({
      programs: () => ok(BUYABLE_PROGRAM),
      clients: () => ok(null),
      bot_logs: () => ok(null),
      purchase_requests: (calls, terminal) => {
        if (calls.some((c) => c.method === "insert")) return ok(null);
        if (terminal === "maybeSingle") return ok(latest);
        return ok(null) as Row & { count: number };
      },
    });
  }

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

    await startPurchase(ctx, VALID_PROGRAM_ID);

    expect(ctx.reply).toHaveBeenCalledWith(
      "Программа недоступна для покупки. Свяжитесь с тренером.",
    );
  });

  it("rejects zero-price and null-price programs", async () => {
    for (const price of [0, null]) {
      mockDb({ programs: () => ok({ ...BUYABLE_PROGRAM, price }) });
      const ctx = makeCtx();
      await startPurchase(ctx, VALID_PROGRAM_ID);
      expect(ctx.reply).toHaveBeenCalledWith(
        "Программа недоступна для покупки. Свяжитесь с тренером.",
      );
    }
  });

  it("blocks purchase of a program the client already owns", async () => {
    mockDb({
      programs: () => ok(BUYABLE_PROGRAM),
      clients: () => ok({ id: "c-1", program_id: "prog-1", language: "ru" }),
    });
    const ctx = makeCtx();

    await startPurchase(ctx, VALID_PROGRAM_ID);

    expect(ctx.reply).toHaveBeenCalledWith(
      "Эта программа уже у вас есть. Свяжитесь с тренером, если нужна другая.",
    );
    expect(callsFor("purchase_requests")).toEqual([]);
  });

  it("creates a request (with order_id/amount/client_id) and shows the consent step", async () => {
    defaultDb();
    const ctx = makeCtx();

    await startPurchase(ctx, VALID_PROGRAM_ID);

    const insert = callsFor("purchase_requests").find((c) => c.method === "insert");
    expect(insert).toBeDefined();
    const payload = insert?.args[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      program_id: "prog-1",
      name: "Иван Петров",
      contact: "@buyer",
      telegram_id: 123456789,
      first_name: "Иван",
      last_name: "Петров",
      sub_type: "program",
      client_id: null,
      amount: 9900,
    });
    // order_id = id заявки (для матчинга вебхука Продамуса)
    expect(payload.id).toEqual(expect.any(String));
    expect(payload.order_id).toBe(payload.id);
    expect(String(payload.id)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    const text = firstReplyText(ctx);
    expect(text).toContain("Согласие на обработку данных");
    expect(text).toContain("«Сила Новичка 12 недель»");
    expect(text).toContain(`9\u00A0900 ₽`);
    expect(text).toContain("portal.example.com");
    expect(keyboardJson(replyOptions(ctx))).toContain(`consent_purchase:${payload.id}`);
  });

  it("reuses a pending request without consent and re-shows the consent step", async () => {
    defaultDb({ id: "req-1", status: "pending", consent_given: false, amount: 9900 });
    const ctx = makeCtx();

    await startPurchase(ctx, VALID_PROGRAM_ID);

    expect(callsFor("purchase_requests").some((c) => c.method === "insert")).toBe(false);
    expect(keyboardJson(replyOptions(ctx))).toContain("consent_purchase:req-1");
  });

  it("reuses a consented pending request and sends the payment link with the stored amount", async () => {
    defaultDb({ id: "req-1", status: "pending", consent_given: true, amount: 8900 });
    const ctx = makeCtx();

    await startPurchase(ctx, VALID_PROGRAM_ID);

    expect(callsFor("purchase_requests").some((c) => c.method === "insert")).toBe(false);
    const buttons = keyboardJson(replyOptions(ctx));
    expect(buttons).toContain(`"url":"https://pay.demo.prodamus.ru/payment?do=pay&order_id=req-1`);
    // ссылка строится по снапшоту суммы из заявки, а не по текущей цене
    expect(buttons).toContain("%5B0%5D%5Bprice%5D=8900.00");
  });

  it("does not offer a second payment for an already paid request", async () => {
    defaultDb({ id: "req-1", status: "paid", consent_given: true, amount: 9900 });
    const ctx = makeCtx();

    await startPurchase(ctx, VALID_PROGRAM_ID);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Заявка уже оплачена"));
    expect(callsFor("purchase_requests").some((c) => c.method === "insert")).toBe(false);
  });

  it("allows a new request after the coach cancelled the previous one", async () => {
    defaultDb({ id: "req-1", status: "cancelled", consent_given: true, amount: 9900 });
    const ctx = makeCtx();

    await startPurchase(ctx, VALID_PROGRAM_ID);

    const insert = callsFor("purchase_requests").find((c) => c.method === "insert");
    expect(insert).toBeDefined();
    expect(keyboardJson(replyOptions(ctx))).toContain("consent_purchase:");
  });

  it("blocks new requests when the user already has too many pending", async () => {
    mockDb({
      programs: () => ok(BUYABLE_PROGRAM),
      clients: () => ok(null),
      purchase_requests: (_calls, terminal) => {
        if (terminal === "maybeSingle") return ok(null);
        return { data: null, error: null, count: 3 };
      },
    });
    const ctx = makeCtx();

    await startPurchase(ctx, VALID_PROGRAM_ID);

    expect(ctx.reply).toHaveBeenCalledWith(
      "❌ Слишком много активных заявок. Дождитесь ответа тренера.",
    );
    expect(callsFor("purchase_requests").some((c) => c.method === "insert")).toBe(false);
    // форма счётчика зафиксирована (head:true + count:exact)
    const countSelect = [...callsFor("purchase_requests")].reverse().find((c) => c.method === "select");
    expect(countSelect?.args).toEqual(["id", { count: "exact", head: true }]);
  });

  it("fails closed when the pending count query errors", async () => {
    mockDb({
      programs: () => ok(BUYABLE_PROGRAM),
      clients: () => ok(null),
      purchase_requests: (_calls, terminal) => {
        if (terminal === "maybeSingle") return ok(null);
        return { data: null, error: { code: "500", message: "count boom" } };
      },
    });
    const ctx = makeCtx();

    await startPurchase(ctx, VALID_PROGRAM_ID);

    expect(ctx.reply).toHaveBeenCalledWith(
      "❌ Не удалось оформить заявку. Попробуйте позже.",
    );
    expect(callsFor("purchase_requests").some((c) => c.method === "insert")).toBe(false);
  });

  it("falls back to the winning request on duplicate-key insert (double tap race)", async () => {
    let maybeCalls = 0;
    mockDb({
      programs: () => ok(BUYABLE_PROGRAM),
      clients: () => ok(null),
      bot_logs: () => ok(null),
      purchase_requests: (calls, terminal) => {
        if (calls.some((c) => c.method === "insert")) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        if (terminal === "maybeSingle") {
          maybeCalls += 1;
          // первый read — ничего нет; после failed insert возвращаем "победителя"
          if (maybeCalls === 1) return ok(null);
          return ok({ id: "req-1", status: "pending", consent_given: false, amount: 9900 });
        }
        return { data: null, error: null, count: 0 };
      },
    });
    const ctx = makeCtx();

    await startPurchase(ctx, VALID_PROGRAM_ID);

    expect(keyboardJson(replyOptions(ctx))).toContain("consent_purchase:req-1");
    const inserts = callsFor("purchase_requests").filter((c) => c.method === "insert");
    expect(inserts).toHaveLength(1);
  });

  it("reports already_paid when the duplicate-key winner is paid", async () => {
    let maybeCalls = 0;
    mockDb({
      programs: () => ok(BUYABLE_PROGRAM),
      clients: () => ok(null),
      purchase_requests: (calls, terminal) => {
        if (calls.some((c) => c.method === "insert")) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        if (terminal === "maybeSingle") {
          maybeCalls += 1;
          if (maybeCalls === 1) return ok(null);
          return ok({ id: "req-1", status: "paid", consent_given: true, amount: 9900 });
        }
        return { data: null, error: null, count: 0 };
      },
    });
    const ctx = makeCtx();

    await startPurchase(ctx, VALID_PROGRAM_ID);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Заявка уже оплачена"));
  });

  it("replies with an error when the insert fails", async () => {
    mockDb({
      programs: () => ok(BUYABLE_PROGRAM),
      clients: () => ok(null),
      purchase_requests: (calls, terminal) => {
        if (calls.some((c) => c.method === "insert")) {
          return { data: null, error: { code: "500", message: "boom" } };
        }
        if (terminal === "maybeSingle") return ok(null);
        return { data: null, error: null, count: 0 };
      },
    });
    const ctx = makeCtx();

    await startPurchase(ctx, VALID_PROGRAM_ID);

    expect(ctx.reply).toHaveBeenCalledWith(
      "❌ Не удалось оформить заявку. Попробуйте позже.",
    );
  });
});

describe("handleConsentPurchase", () => {
  const REQ = {
    id: "req-1",
    program_id: "prog-1",
    status: "pending",
    consent_given: false,
    sub_type: "program",
    telegram_id: 123456789,
    amount: 9900,
  };

  // consentDb эмулирует цепочку: initial read → consent update → re-verify read
  // → clients lookup → paid-request check
  function consentDb({
    request = REQ,
    afterConsent = null,
    clientsData = null,
    paidRequest = null,
    programsData = BUYABLE_PROGRAM,
  }: {
    request?: unknown;
    afterConsent?: unknown;
    clientsData?: unknown;
    paidRequest?: unknown;
    programsData?: unknown;
  } = {}) {
    let reads = 0;
    mockDb({
      purchase_requests: (calls, terminal) => {
        if (terminal === "then") return ok(null);
        if (calls.some((c) => c.method === "limit")) return ok(paidRequest);
        if (terminal === "maybeSingle") {
          reads += 1;
          if (reads === 1) return ok(request);
          return ok(afterConsent ?? { ...(request as object), consent_given: true });
        }
        return ok(null);
      },
      clients: () => ok(clientsData),
      programs: () => ok(programsData),
    });
  }

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
    consentDb({ request: { ...REQ, telegram_id: 999 } });
    const ctx = makeCtx();

    await handleConsentPurchase(ctx, REQUEST_ID);

    expect(ctx.reply).toHaveBeenCalledWith(
      "Заявка не найдена. Начните покупку заново через /programs.",
    );
    expect(callsFor("purchase_requests").some((c) => c.method === "update")).toBe(false);
  });

  it("warns when the request is already paid", async () => {
    consentDb({ request: { ...REQ, status: "paid", consent_given: true } });
    const ctx = makeCtx();

    await handleConsentPurchase(ctx, REQUEST_ID);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Заявка уже оплачена"));
    expect(callsFor("purchase_requests").some((c) => c.method === "update")).toBe(false);
  });

  it("refuses to revive a cancelled request", async () => {
    consentDb({ request: { ...REQ, status: "cancelled", consent_given: true } });
    const ctx = makeCtx();

    await handleConsentPurchase(ctx, REQUEST_ID);

    expect(ctx.reply).toHaveBeenCalledWith(
      "Заявка не найдена. Начните покупку заново через /programs.",
    );
    expect(callsFor("purchase_requests").some((c) => c.method === "update")).toBe(false);
    expect(replyOptions(ctx)).toEqual({});
  });

  it("records consent with version and sends a payment link", async () => {
    const updates: Record<string, unknown>[] = [];
    let reads = 0;
    mockDb({
      purchase_requests: (calls, terminal) => {
        const updateCall = calls.find((c) => c.method === "update");
        if (updateCall) updates.push(updateCall.args[0] as Record<string, unknown>);
        if (updateCall) return ok(null);
        if (terminal === "then") return ok(null);
        if (calls.some((c) => c.method === "limit")) return ok(null);
        if (terminal === "maybeSingle") {
          reads += 1;
          if (reads === 1) return ok(REQ);
          return ok({ ...REQ, consent_given: true });
        }
        return ok(null);
      },
      clients: () => ok(null),
      programs: () => ok(BUYABLE_PROGRAM),
    });
    const ctx = makeCtx();

    await handleConsentPurchase(ctx, REQUEST_ID);

    expect(updates).toHaveLength(1);
    expect(updates[0].consent_given).toBe(true);
    expect(updates[0].consent_version).toBe("2026-07-16");
    expect(updates[0].consent_at).toEqual(expect.any(String));

    // guard-фильтры на статус/владельца/дубль согласия
    const eqs = callsFor("purchase_requests")
      .filter((c) => c.method === "eq")
      .map((c) => c.args);
    expect(eqs).toContainEqual(["id", REQUEST_ID]);
    expect(eqs).toContainEqual(["telegram_id", 123456789]);
    expect(eqs).toContainEqual(["status", "pending"]);
    expect(eqs).toContainEqual(["consent_given", false]);

    const text = firstReplyText(ctx);
    expect(text).toContain("Спасибо! Согласие принято.");
    const buttons = keyboardJson(replyOptions(ctx));
    expect(buttons).toContain(`"url":"https://pay.demo.prodamus.ru/payment?do=pay&order_id=${REQUEST_ID}`);
    expect(buttons).toContain("%5B0%5D%5Bprice%5D=9900.00");
  });

  it("builds the payment link from the stored amount snapshot, not the current price", async () => {
    // заявка зафиксировала 8900, а цена программы с тех пор выросла до 9900
    consentDb({
      request: { ...REQ, amount: 8900 },
      afterConsent: { ...REQ, consent_given: true, amount: 8900 },
    });
    const ctx = makeCtx();

    await handleConsentPurchase(ctx, REQUEST_ID);

    const buttons = keyboardJson(replyOptions(ctx));
    expect(buttons).toContain("%5B0%5D%5Bprice%5D=8900.00");
    expect(buttons).not.toContain("%5B0%5D%5Bprice%5D=9900.00");
  });

  it("does not re-record consent when already given", async () => {
    consentDb({ request: { ...REQ, consent_given: true } });
    const ctx = makeCtx();

    await handleConsentPurchase(ctx, REQUEST_ID);

    expect(callsFor("purchase_requests").some((c) => c.method === "update")).toBe(false);
    expect(keyboardJson(replyOptions(ctx))).toContain(`order_id=${REQUEST_ID}`);
  });

  it("still sends the link on a double tap (consent already recorded concurrently)", async () => {
    // update затронул 0 строк (согласие поставил параллельный тап), но
    // финальная проверка видит consent_given=true → ссылка выдаётся
    consentDb({
      request: REQ,
      afterConsent: { ...REQ, consent_given: true },
    });
    const ctx = makeCtx();

    await handleConsentPurchase(ctx, REQUEST_ID);

    expect(keyboardJson(replyOptions(ctx))).toContain(`order_id=${REQUEST_ID}`);
  });

  it("aborts when the request status flips during consent (TOCTOU)", async () => {
    consentDb({
      request: REQ,
      afterConsent: { ...REQ, consent_given: true, status: "cancelled" },
    });
    const ctx = makeCtx();

    await handleConsentPurchase(ctx, REQUEST_ID);

    expect(ctx.reply).toHaveBeenCalledWith(
      "Заявка не найдена. Начните покупку заново через /programs.",
    );
    expect(replyOptions(ctx)).toEqual({});
  });

  it("does not issue a link when the program was already assigned to the client", async () => {
    consentDb({
      request: { ...REQ, consent_given: true },
      clientsData: { id: "c-1", program_id: "prog-1", language: "ru" },
    });
    const ctx = makeCtx();

    await handleConsentPurchase(ctx, REQUEST_ID);

    expect(ctx.reply).toHaveBeenCalledWith(
      "Эта программа уже у вас есть. Свяжитесь с тренером, если нужна другая.",
    );
    expect(replyOptions(ctx)).toEqual({});
  });

  it("does not issue a link when a paid request already exists", async () => {
    consentDb({
      request: { ...REQ, consent_given: true },
      paidRequest: { id: "paid-1" },
    });
    const ctx = makeCtx();

    await handleConsentPurchase(ctx, REQUEST_ID);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Заявка уже оплачена"));
    expect(replyOptions(ctx)).toEqual({});
  });

  it("does not write consent when the program is no longer buyable", async () => {
    consentDb({ programsData: null });
    const ctx = makeCtx();

    await handleConsentPurchase(ctx, REQUEST_ID);

    expect(ctx.reply).toHaveBeenCalledWith(
      "Программа недоступна для покупки. Свяжитесь с тренером.",
    );
    expect(callsFor("purchase_requests").some((c) => c.method === "update")).toBe(false);
  });

  it("replies payment_unavailable when the payform URL is not configured", async () => {
    (config as { prodamusPayformBaseUrl: string }).prodamusPayformBaseUrl = "";
    consentDb({ request: { ...REQ, consent_given: true } });
    const ctx = makeCtx();

    await handleConsentPurchase(ctx, REQUEST_ID);

    expect(ctx.reply).toHaveBeenCalledWith(
      "Оплата временно недоступна. Попробуйте позже или свяжитесь с тренером.",
    );
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