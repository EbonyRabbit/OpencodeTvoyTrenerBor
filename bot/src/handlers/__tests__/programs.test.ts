import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildProgramRequestCoachMessage } from "../../lib/program-links.js";
import { programsHandler, handleProgramDetailsCallback } from "../programs.js";
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

type QueryCall = { method: string; args: unknown[] };

function mockProgramsQuery(data: Record<string, unknown>[], clientData: unknown = null) {
  const calls: QueryCall[] = [];
  const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  const chain = {
    select: (...args: unknown[]) => {
      calls.push({ method: "select", args });
      return chain;
    },
    eq: (...args: unknown[]) => {
      calls.push({ method: "eq", args });
      return chain;
    },
    is: (...args: unknown[]) => {
      calls.push({ method: "is", args });
      return chain;
    },
    order: (...args: unknown[]) => {
      calls.push({ method: "order", args });
      return chain;
    },
    then: (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(onFulfilled),
  };
  const clientChain = {
    select: (...args: unknown[]) => {
      calls.push({ method: "select", args });
      return clientChain;
    },
    eq: (...args: unknown[]) => {
      calls.push({ method: "eq", args });
      return clientChain;
    },
    maybeSingle: () => Promise.resolve({ data: clientData, error: null }),
  };
  fake.from.mockImplementation((table: string) => {
    if (table === "programs") return chain;
    if (table === "clients") return clientChain;
    throw new Error(`Unexpected table: ${table}`);
  });
  return calls;
}

function makeCtx() {
  return {
    from: { id: 123456789, username: "buyer" },
    language: "ru",
    reply: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  } as unknown as MyContext;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("programsHandler catalog query", () => {
  it("filters the catalog by type=template to hide personal programs", async () => {
    const calls = mockProgramsQuery([
      {
        id: "tpl-1",
        title: "Сила Новичка 12 недель",
        type: "template",
        description: null,
        duration_weeks: 12,
        price: 9900,
      },
    ]);
    const ctx = makeCtx();

    await programsHandler(ctx);

    const eqCalls = calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqCalls).toContainEqual(["type", "template"]);
    expect(ctx.reply).toHaveBeenCalled();
  });

  it("shows an empty message when no template programs exist", async () => {
    mockProgramsQuery([]);
    const ctx = makeCtx();

    await programsHandler(ctx);

    const options = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(options[0]).toBe("Нет доступных программ.");
    expect(JSON.stringify(options[1]?.reply_markup ?? [])).toContain("coach_request");
  });

  it("adds a purchase_start button only for priced programs", async () => {
    mockProgramsQuery([
      {
        id: "tpl-buy",
        title: "Платная",
        type: "template",
        description: null,
        duration_weeks: 12,
        price: 9900,
      },
      {
        id: "tpl-free",
        title: "Бесплатная",
        type: "template",
        description: null,
        duration_weeks: 12,
        price: null,
      },
    ]);
    const ctx = makeCtx();

    await programsHandler(ctx);

    const options = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      reply_markup?: unknown;
    };
    const keyboard = JSON.stringify(options.reply_markup ?? []);
    expect(keyboard).toContain("purchase_start:tpl-buy");
    expect(keyboard).not.toContain("purchase_start:tpl-free");
    expect(keyboard).toContain("program_request:tpl-buy");
    expect(keyboard).toContain("program_request:tpl-free");
    // у каждой программы есть кнопка «Подробнее»
    expect(keyboard).toContain("program_details:tpl-buy");
    expect(keyboard).toContain("program_details:tpl-free");
  });

  it("uses short button labels so full titles live in the text", async () => {
    mockProgramsQuery([
      {
        id: "tpl-buy",
        title: "HYROX 5×12 — подготовка к гонке",
        type: "template",
        description: null,
        duration_weeks: 12,
        price: 9900,
      },
    ]);
    const ctx = makeCtx();

    await programsHandler(ctx);

    const text = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(text).toContain("HYROX 5×12 — подготовка к гонке"); // название целиком
    const options = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      reply_markup?: unknown;
    };
    const keyboard = JSON.stringify(options.reply_markup ?? []);
    // короткие подписи без дублирования названия и без обрезки «…»
    expect(keyboard).toContain("ℹ️ Подробнее");
    expect(keyboard).toContain("💳 Купить");
    expect(keyboard).toContain("📩 Запросить");
    expect(keyboard).not.toContain("— HYROX");
  });

  it("hides the buy button for a program the client already owns", async () => {
    mockProgramsQuery(
      [
        {
          id: "tpl-buy",
          title: "Платная",
          type: "template",
          description: null,
          duration_weeks: 12,
          price: 9900,
        },
      ],
      { id: "c-1", program_id: "tpl-buy", language: "ru" },
    );
    const ctx = makeCtx();

    await programsHandler(ctx);

    const options = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      reply_markup?: unknown;
    };
    const keyboard = JSON.stringify(options.reply_markup ?? []);
    expect(keyboard).not.toContain("purchase_start:tpl-buy");
    expect(keyboard).toContain("program_request:tpl-buy");
  });

  it("adds a coach_request button at the bottom of the catalog", async () => {
    mockProgramsQuery([
      {
        id: "tpl-buy",
        title: "Платная",
        type: "template",
        description: null,
        duration_weeks: 12,
        price: 9900,
      },
    ]);
    const ctx = makeCtx();

    await programsHandler(ctx);

    const options = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      reply_markup?: unknown;
    };
    const keyboard = JSON.stringify(options.reply_markup ?? []);
    expect(keyboard).toContain(`"text":"📞 Связаться с тренером","callback_data":"coach_request"`);
  });

  it("adds a coach_request button when the catalog is empty", async () => {
    mockProgramsQuery([]);
    const ctx = makeCtx();

    await programsHandler(ctx);

    const options = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      reply_markup?: unknown;
    };
    const keyboard = JSON.stringify(options.reply_markup ?? []);
    expect(keyboard).toContain("coach_request");
  });
});


describe("buildProgramRequestCoachMessage", () => {
  it("includes name, username link and tg id", () => {
    const msg = buildProgramRequestCoachMessage({
      clientName: "Иван",
      telegramId: 123456789,
      username: "iurii",
      programTitle: "Сушка",
    });
    expect(msg).toContain("👤 Иван");
    expect(msg).toContain("🔗 @iurii (https://t.me/iurii)");
    expect(msg).toContain("🆔 TG ID: 123456789");
    expect(msg).toContain("Хочет: Сушка");
  });

  it("still shows tg id when username is missing", () => {
    const msg = buildProgramRequestCoachMessage({
      clientName: "Иван",
      telegramId: 123456789,
      username: null,
      programTitle: "Сушка",
    });
    expect(msg).toContain("🆔 TG ID: 123456789");
    expect(msg).not.toContain("@");
  });

  it("keeps blank separator lines (no collapsed message)", () => {
    const msg = buildProgramRequestCoachMessage({
      clientName: "Иван",
      telegramId: 123456789,
      username: null,
      programTitle: "Сушка",
    });
    expect(msg).toBe(
      "📩 Запрос от клиента\n" +
        "\n" +
        "👤 Иван\n" +
        "🆔 TG ID: 123456789\n" +
        "\n" +
        "Хочет: Сушка\n" +
        "\n" +
        "Свяжитесь с клиентом в Telegram.",
    );
  });

  it("builds exact message with username link", () => {
    const msg = buildProgramRequestCoachMessage({
      clientName: "Иван",
      telegramId: 123456789,
      username: "iurii",
      programTitle: "Сушка",
    });
    expect(msg).toBe(
      "📩 Запрос от клиента\n" +
        "\n" +
        "👤 Иван\n" +
        "🔗 @iurii (https://t.me/iurii)\n" +
        "🆔 TG ID: 123456789\n" +
        "\n" +
        "Хочет: Сушка\n" +
        "\n" +
        "Свяжитесь с клиентом в Telegram.",
    );
  });
});

const DETAILS_ID = "d1e2f3a4-b2c3-4d5e-8f90-1a2b3c4d5e6f";

function mockDetailsQuery(
  programData: Record<string, unknown> | null,
  clientData: unknown = null,
) {
  const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  fake.from.mockImplementation((table: string) => {
    if (table === "programs") {
      const chainP: Record<string, unknown> = {};
      const link = (..._a: unknown[]) => chainP;
      chainP.select = link;
      chainP.eq = link;
      chainP.is = link;
      chainP.maybeSingle = () => Promise.resolve({ data: programData, error: null });
      return chainP;
    }
    if (table === "clients") {
      const chainC: Record<string, unknown> = {};
      const clink = (..._a: unknown[]) => chainC;
      chainC.select = clink;
      chainC.eq = clink;
      chainC.maybeSingle = () => Promise.resolve({ data: clientData, error: null });
      return chainC;
    }
    throw new Error(`Unexpected table: ${table}`);
  });
}

describe("handleProgramDetailsCallback", () => {
  const fullDescription =
    "Полное описание программы: подготовка к гонке HYROX с детализацией по неделям, силовыми и интервальными блоками, тестовыми заездами и рекомендациями по восстановлению. ".repeat(3);

  it("показывает полное название и полное описание (без обрезки до 100 симв.)", async () => {
    mockDetailsQuery({
      id: DETAILS_ID,
      title: "HYROX 5×12 — подготовка к гонке",
      type: "template",
      description: fullDescription,
      duration_weeks: 12,
      price: 7770,
    });
    const ctx = makeCtx();

    await handleProgramDetailsCallback(ctx, DETAILS_ID);

    const text = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(text).toContain("HYROX 5×12 — подготовка к гонке");
    expect(text).toContain(fullDescription.slice(0, 120));
    expect(text.length).toBeGreaterThan(300);
    const options = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      reply_markup?: unknown;
    };
    expect(JSON.stringify(options.reply_markup ?? [])).toContain(
      `purchase_start:${DETAILS_ID}`,
    );
  });

  it("скрывает кнопку «Купить» для владельца программы", async () => {
    mockDetailsQuery(
      {
        id: DETAILS_ID,
        title: "HYROX",
        type: "template",
        description: "desc",
        duration_weeks: 12,
        price: 7770,
      },
      { id: "c-9", program_id: DETAILS_ID, language: "ru" },
    );
    const ctx = makeCtx();

    await handleProgramDetailsCallback(ctx, DETAILS_ID);

    const options = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      reply_markup?: unknown;
    };
    const keyboard = JSON.stringify(options.reply_markup ?? []);
    expect(keyboard).not.toContain(`purchase_start:${DETAILS_ID}`);
    expect(keyboard).toContain(`program_request:${DETAILS_ID}`);
  });

  it("сообщает not_found для скрытой/удалённой программы", async () => {
    mockDetailsQuery(null);
    const ctx = makeCtx();

    await handleProgramDetailsCallback(ctx, DETAILS_ID);

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    const text = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(text).toBe("Программа не найдена.");
  });

  it("отклоняет невалидный UUID через alert", async () => {
    const ctx = makeCtx();

    await handleProgramDetailsCallback(ctx, "not-a-uuid");

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ show_alert: true }),
    );
    expect(ctx.reply).not.toHaveBeenCalled();
  });
it("отвечает service_unavailable при ошибке БД", async () => {
    const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    fake.from.mockImplementation(() => {
      throw new Error("db down");
    });
    const ctx = makeCtx();

    await handleProgramDetailsCallback(ctx, DETAILS_ID);

    const text = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(text).toContain("Сервис");
  });

  it("обрезает экстремально длинное описание до лимита Telegram", async () => {
    mockDetailsQuery({
      id: DETAILS_ID,
      title: "HYROX",
      type: "template",
      description: "Очень длинное описание. ".repeat(400), // ~10k символов
      duration_weeks: 12,
      price: 7770,
    });
    const ctx = makeCtx();

    await handleProgramDetailsCallback(ctx, DETAILS_ID);

    const text = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text).toContain("Сообщение обрезано");
  });
});
