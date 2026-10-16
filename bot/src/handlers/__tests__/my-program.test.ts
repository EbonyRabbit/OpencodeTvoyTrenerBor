import { describe, it, expect, vi, beforeEach } from "vitest";
import { myProgramHandler } from "../my-program.js";
import { guardActiveClient } from "../guards.js";
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

vi.mock("../guards.js", () => ({
  guardActiveClient: vi.fn(),
}));

const CLIENT = {
  id: "c-1",
  program_id: "p-1",
  name: "Юра",
  timezone: null,
  training_days: null,
  spreadsheet_id: null,
};

function mockQueries(programData: Record<string, unknown> | null) {
  const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  fake.from.mockImplementation((table: string) => {
    if (table === "programs") {
      const chain: Record<string, unknown> = {};
      const link = (..._a: unknown[]) => chain;
      chain.select = link;
      chain.eq = link;
      chain.maybeSingle = () => Promise.resolve({ data: programData, error: null });
      return chain;
    }
    if (table === "program_schedule") {
      const chain: Record<string, unknown> = {};
      const link = (..._a: unknown[]) => chain;
      chain.select = link;
      chain.eq = link;
      chain.order = link;
      chain.then = (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(onFulfilled);
      return chain;
    }
    throw new Error(`Unexpected table: ${table}`);
  });
}

function makeCtx() {
  return {
    from: { id: 123456789, username: "client" },
    language: "ru",
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as MyContext;
}

function lastReplyText(ctx: MyContext): string {
  const calls = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1]?.[0] as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  (guardActiveClient as ReturnType<typeof vi.fn>).mockResolvedValue({ client: CLIENT });
});

describe("myProgramHandler glossary", () => {
  it("показывает секцию «Справка» с пунктами glossary", async () => {
    mockQueries({
      id: "p-1",
      title: "HYROX 5×12",
      type: "template",
      duration_weeks: 12,
      description: "Описание",
      parsed_content: {
        version: 1,
        weeks: [],
        notes: ["Операционная заметка"],
        glossary: [
          "Зоны пульса: Z1 55-65% (восстановление), Z2 65-75% (лёгкий бег).",
          "RPE - воспринимаемая нагрузка по шкале 1-10.",
        ],
      },
    });
    const ctx = makeCtx();

    await myProgramHandler(ctx);

    const text = lastReplyText(ctx);
    expect(text).toContain("Справка по терминам");
    expect(text).toContain("Зоны пульса: Z1 55-65%");
    expect(text).toContain("RPE - воспринимаемая нагрузка по шкале 1-10");
    expect(text).toContain("• ");
  });

  it("не показывает секцию, когда glossary отсутствует", async () => {
    mockQueries({
      id: "p-1",
      title: "Программа без справки",
      type: "template",
      duration_weeks: 12,
      description: "Описание",
      parsed_content: {
        version: 1,
        weeks: [],
        notes: ["Операционная заметка"],
      },
    });
    const ctx = makeCtx();

    await myProgramHandler(ctx);

    const text = lastReplyText(ctx);
    expect(text).not.toContain("Справка по терминам");
    expect(text).toContain("Описание");
  });

  it("не показывает секцию при пустом glossary", async () => {
    mockQueries({
      id: "p-1",
      title: "Программа",
      type: "template",
      duration_weeks: 12,
      description: null,
      parsed_content: { version: 1, weeks: [], glossary: [] },
    });
    const ctx = makeCtx();

    await myProgramHandler(ctx);

    expect(lastReplyText(ctx)).not.toContain("Справка по терминам");
  });
});
