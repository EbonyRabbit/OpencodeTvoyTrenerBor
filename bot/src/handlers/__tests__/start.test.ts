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

type Query = {
  table: string;
  op: "select" | "update";
  eq: Record<string, unknown>;
  is: Record<string, unknown>;
  updatePayload?: Record<string, unknown>;
};

function makeCtx(overrides: Partial<MyContext> & { text?: string; from?: { id?: number; username?: string } } = {}) {
  const { text = "/start", from = { id: 123456789, username: "Buyer_123" }, ...rest } = overrides;
  return {
    from,
    message: { text },
    language: "ru",
    reply: vi.fn().mockResolvedValue(undefined),
    ...rest,
  } as unknown as MyContext;
}

function setupClientsDb(opts: {
  byTelegramId?: Record<number, { data: unknown; error: unknown }>;
  byConnectCode?: Record<string, { data: unknown; error: unknown }>;
  connectUpdate?: { data: unknown; error: unknown };
  subscriptionRow?: unknown;
  nameUpdateError?: unknown;
}) {
  const queries: Query[] = [];
  const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  fake.from.mockImplementation((table: string) => {
    const state: Query = { table, op: "select", eq: {}, is: {} };
    const resolve = async () => {
      if (state.op === "update") {
        const payload = state.updatePayload ?? {};
        if ("name" in payload) return { data: null, error: opts.nameUpdateError ?? null };
        return opts.connectUpdate ?? { data: { id: state.eq.id }, error: null };
      }
      if (table === "subscriptions") {
        return { data: opts.subscriptionRow ?? null, error: null };
      }
      if ("telegram_id" in state.eq) {
        const key = state.eq.telegram_id as number;
        return opts.byTelegramId?.[key] ?? { data: null, error: null };
      }
      if ("connect_code" in state.eq) {
        const key = state.eq.connect_code as string;
        return opts.byConnectCode?.[key] ?? { data: null, error: null };
      }
      return { data: null, error: null };
    };
    const chain: any = {
      select: () => chain,
      update: (payload: Record<string, unknown>) => {
        state.op = "update";
        state.updatePayload = payload;
        queries.push(state);
        return chain;
      },
      eq: (col: string, val: unknown) => {
        state.eq[col] = val;
        return chain;
      },
      is: (col: string, val: unknown) => {
        state.is[col] = val;
        return chain;
      },
      in: () => chain,
      limit: () => chain,
      maybeSingle: resolve,
      single: resolve,
      then: (onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) =>
        resolve().then(onFulfilled, onRejected),
    };
    chain.select = (_sel?: string) => {
      if (state.op !== "update") {
        state.op = "select";
        queries.push(state);
      }
      return chain;
    };
    return chain;
  });
  return queries;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("startHandler", () => {
  it("offers programs and the coach_request button to a brand-new user", async () => {
    setupClientsDb({});
    const ctx = makeCtx();

    await startHandler(ctx);

    const options = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      reply_markup?: unknown;
    };
    const keyboard = JSON.stringify(options.reply_markup ?? []);
    expect(keyboard).toContain("programs_open");
    expect(keyboard).toContain("coach_request");
  });

  it("updates client username on /start for existing active paid client", async () => {
    const client = {
      id: "11111111-1111-1111-1111-111111111111",
      telegram_id: 123456789,
      name: "Старое Имя",
      status: "active",
      payment_status: "paid",
      client_consent_given: true,
      client_consent_version: "2026-11-20.subscription",
      language: "ru",
      program_id: null,
      training_days: [],
    };
    const queries = setupClientsDb({
      byTelegramId: { 123456789: { data: client, error: null } },
    });
    const ctx = makeCtx();

    await startHandler(ctx);

    const nameUpdates = queries.filter(
      (q) => q.op === "update" && (q.updatePayload as any)?.name === "@buyer_123",
    );
    expect(nameUpdates).toHaveLength(1);
    expect((ctx.client as any).name).toBe("@buyer_123");
  });

  it("lets a pending client with a live subscription through /start", async () => {
    const client = {
      id: "11111111-1111-1111-1111-111111111116",
      telegram_id: 123456789,
      name: "@buyer_123",
      status: "active",
      payment_status: "pending",
      client_consent_given: true,
      client_consent_version: "2026-11-20.subscription",
      language: "ru",
      program_id: "prog-1",
      training_days: [1, 2, 3],
    };
    setupClientsDb({
      byTelegramId: { 123456789: { data: client, error: null } },
      subscriptionRow: { id: "sub-1" },
    });
    const ctx = makeCtx();

    await startHandler(ctx);

    const replies = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => String(call[0]),
    );
    expect(replies.some((text) => text.includes("Программа ещё не назначена"))).toBe(false);
    const keyboard = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      reply_markup?: unknown;
    };
    expect(JSON.stringify(keyboard.reply_markup ?? {})).toContain("programs_open");
  });

  it("uses stable fallback when username is missing", async () => {
    const client = {
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      telegram_id: 123456789,
      name: "Старое Имя",
      status: "active",
      payment_status: "paid",
      client_consent_given: true,
      client_consent_version: "2026-11-20.subscription",
      language: "ru",
      program_id: null,
      training_days: [],
    };
    const queries = setupClientsDb({
      byTelegramId: { 123456789: { data: client, error: null } },
    });
    const ctx = makeCtx({ from: { id: 123456789, username: undefined } });

    await startHandler(ctx);
    const firstName = (ctx.client as any).name as string;

    vi.clearAllMocks();
    const client2 = { ...client, name: firstName };
    const queries2 = setupClientsDb({
      byTelegramId: { 123456789: { data: client2, error: null } },
    });
    const ctx2 = makeCtx({ from: { id: 123456789, username: undefined } });

    await startHandler(ctx2);

    expect(firstName).toMatch(/^Клиент #[A-Z0-9]{6}$/);
    expect((ctx2.client as any).name).toBe(firstName);
    const updates = queries2.filter((q) => q.op === "update" && "name" in ((q.updatePayload ?? {}) as any));
    expect(updates).toHaveLength(0);
  });

  it("syncs username when /start is called with connect code for already connected user", async () => {
    const existing = {
      id: "22222222-2222-2222-2222-222222222222",
      telegram_id: 123456789,
      name: "Клиент #ABC123",
      status: "inactive",
      payment_status: "pending",
      client_consent_given: false,
      language: "ru",
    };
    const queries = setupClientsDb({
      byTelegramId: { 123456789: { data: existing, error: null } },
    });
    const ctx = makeCtx({ text: "/start ABCD1234" });

    await startHandler(ctx);

    const nameUpdates = queries.filter(
      (q) => q.op === "update" && (q.updatePayload as any)?.name === "@buyer_123",
    );
    expect(nameUpdates).toHaveLength(1);
    expect((ctx.client as any).name).toBe("@buyer_123");
  });

  it("does not reject a connected subscriber on a repeated /start CODE", async () => {
    const existing = {
      id: "22222222-2222-2222-2222-222222222226",
      telegram_id: 123456789,
      name: "@buyer_123",
      status: "active",
      payment_status: "pending",
      client_consent_given: true,
      client_consent_version: "2026-11-20.subscription",
      language: "ru",
      program_id: "prog-1",
      training_days: [1, 2, 3],
    };
    setupClientsDb({
      byTelegramId: { 123456789: { data: existing, error: null } },
      subscriptionRow: { id: "sub-2" },
    });
    const ctx = makeCtx({ text: "/start ABCD1234" });

    await startHandler(ctx);

    const replies = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => String(call[0]),
    );
    expect(replies.some((text) => text.includes("Программа ещё не назначена"))).toBe(false);
    const keyboard = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      reply_markup?: unknown;
    };
    expect(JSON.stringify(keyboard.reply_markup ?? {})).toContain("programs_open");
  });

  it("syncs username after connecting by code", async () => {
    const found = {
      id: "33333333-3333-3333-3333-333333333333",
      telegram_id: null,
      name: "Клиент #ABC123",
      status: "active",
      payment_status: "paid",
      client_consent_given: true,
      client_consent_version: "2026-11-20.subscription",
      language: "ru",
      program_id: null,
      training_days: [],
    };
    const queries = setupClientsDb({
      byConnectCode: { ABCD1234: { data: found, error: null } },
      connectUpdate: { data: { id: found.id }, error: null },
    });
    const ctx = makeCtx({ text: "/start ABCD1234" });

    await startHandler(ctx);

    const nameUpdates = queries.filter(
      (q) => q.op === "update" && (q.updatePayload as any)?.name === "@buyer_123",
    );
    expect(nameUpdates.length).toBeGreaterThanOrEqual(1);
    expect((ctx.client as any).name).toBe("@buyer_123");
  });

  it("re-prompts consent when the client accepted an older policy version", async () => {
    const client = {
      id: "44444444-4444-4444-4444-444444444444",
      telegram_id: 123456789,
      name: "@buyer_123",
      status: "active",
      payment_status: "paid",
      client_consent_given: true,
      client_consent_version: "2026-11-18",
      language: "ru",
      program_id: null,
      training_days: [],
    };
    setupClientsDb({
      byTelegramId: { 123456789: { data: client, error: null } },
    });
    const ctx = makeCtx();

    await startHandler(ctx);

    const replies = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => String(call[0]),
    );
    expect(replies.some((text) => text.includes("18+"))).toBe(true);
  });

  it("keeps /start working when cosmetic name sync fails", async () => {
    const client = {
      id: "55555555-5555-5555-5555-555555555555",
      telegram_id: 123456789,
      name: "Старое Имя",
      status: "active",
      payment_status: "paid",
      client_consent_given: true,
      client_consent_version: "2026-11-20.subscription",
      language: "ru",
      program_id: null,
      training_days: [],
    };
    setupClientsDb({
      byTelegramId: { 123456789: { data: client, error: null } },
      nameUpdateError: new Error("db down"),
    });
    const ctx = makeCtx();

    await startHandler(ctx);

    const replies = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => String(call[0]),
    );
    expect(replies.some((text) => text.includes("недоступен"))).toBe(false);
    expect((ctx.client as any).name).toBe("Старое Имя");
  });
});
