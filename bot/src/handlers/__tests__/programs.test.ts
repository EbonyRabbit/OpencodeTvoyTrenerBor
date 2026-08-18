import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildProgramRequestCoachMessage } from "../../lib/program-links.js";
import { programsHandler } from "../programs.js";
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

    expect(ctx.reply).toHaveBeenCalledWith("Нет доступных программ.");
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