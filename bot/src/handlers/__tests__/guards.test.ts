import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabaseAdmin } from "../../lib/supabase-admin.js";
import { findClientByTelegramId } from "../../lib/clients.js";
import { guardActiveClient } from "../guards.js";
import type { MyContext } from "../../bot.js";
import type { Client } from "../../lib/clients.js";

vi.mock("../../lib/clients.js", () => ({
  findClientByTelegramId: vi.fn(),
}));

vi.mock("../../i18n/index.js", () => ({
  t: vi.fn((key: string) => `t:${key}`),
  applyClientLanguage: vi.fn(),
}));

vi.mock("../../lib/supabase-admin.js", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

type ChainCall = { method: string; args: unknown[] };

function makeChain(terminalResult: { data: unknown; error: unknown }) {
  const calls: ChainCall[] = [];
  const chain: Record<string, unknown> = {
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
    lt: (...args: unknown[]) => {
      calls.push({ method: "lt", args });
      return chain;
    },
    gt: (...args: unknown[]) => {
      calls.push({ method: "gt", args });
      return chain;
    },
    limit: (...args: unknown[]) => {
      calls.push({ method: "limit", args });
      return chain;
    },
    update: (...args: unknown[]) => {
      calls.push({ method: "update", args });
      return chain;
    },
    maybeSingle: () =>
      Promise.resolve({ data: terminalResult.data, error: terminalResult.error }),
    then: (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve(terminalResult).then(onFulfilled),
  };
  return { chain, calls };
}

type DbConfig = {
  planPauseRow?: { id: string } | null;
  clientUpdateRows?: unknown[] | null;
};

function mockFrom(cfg: DbConfig) {
  const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  fromMock.from.mockImplementation((table: string) => {
    if (table === "plan_pauses") {
      return makeChain({
        data: cfg.planPauseRow ?? null,
        error: null,
      }).chain;
    }
    if (table === "clients") {
      return makeChain({
        data: cfg.clientUpdateRows ?? [],
        error: null,
      }).chain;
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  return fromMock.from;
}

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: "client-1",
    telegram_id: 123456789,
    status: "active",
    language: "ru",
    payment_status: "paid",
    program_id: "prog-1",
    timezone: "Europe/Moscow",
    access_end_date: null,
    ...overrides,
  } as Client;
}

function makeCtx(): MyContext {
  return {
    from: { id: 123456789 },
    language: "ru",
    reply: vi.fn().mockResolvedValue({}),
  } as unknown as MyContext;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("guardActiveClient - ленивое автоистечение доступа (21.10)", () => {
  it("пропускает активного клиента с будущей датой доступа", async () => {
    mockFrom({});
    vi.mocked(findClientByTelegramId).mockResolvedValue(
      makeClient({
        access_end_date: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      }),
    );

    const result = await guardActiveClient(makeCtx());
    expect(typeof result).not.toBe("string");
    expect(result).toHaveProperty("client");
  });

  it("истекает доступ при прошедшей дате: сообщение + условный UPDATE", async () => {
    const capturedCalls: Record<string, ChainCall[]> = {};
    const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    fromMock.from.mockImplementation((table: string) => {
      if (table === "plan_pauses") {
        const c = makeChain({ data: null, error: null });
        return c.chain;
      }
      const c = makeChain({ data: [{ id: "client-1" }], error: null });
      capturedCalls[table] = c.calls;
      return c.chain;
    });
    vi.mocked(findClientByTelegramId).mockResolvedValue(
      makeClient({
        access_end_date: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      }),
    );

    const ctx = makeCtx();
    const result = await guardActiveClient(ctx);
    expect(result).toBe("t:client.access_expired");

    const updateCalls = capturedCalls["clients"] ?? [];
    const update = updateCalls.find((c) => c.method === "update");
    expect(update?.args?.[0]).toEqual({ status: "access_expired" });
    const eqs = updateCalls.filter((c) => c.method === "eq");
    expect(eqs.some((c) => c.args[0] === "id" && c.args[1] === "client-1")).toBe(true);
    expect(eqs.some((c) => c.args[0] === "status" && c.args[1] === "active")).toBe(true);
    const lts = updateCalls.filter((c) => c.method === "lt");
    expect(lts.length).toBe(1);
    const [ltCol, ltVal] = lts[0]?.args as [string, string];
    expect(ltCol).toBe("access_end_date");
    // nowIso в момент запроса - валидный ISO, не позже текущего момента + 1с
    expect(new Date(ltVal).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("не истекает клиента на активной паузе", async () => {
    mockFrom({ planPauseRow: { id: "pause-1" } });
    vi.mocked(findClientByTelegramId).mockResolvedValue(
      makeClient({
        access_end_date: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      }),
    );

    const result = await guardActiveClient(makeCtx());
    expect(result).toHaveProperty("client");
  });

  it("при гонке с продлением (UPDATE вернул 0 строк) доступ сохраняется", async () => {
    mockFrom({ clientUpdateRows: [] });
    vi.mocked(findClientByTelegramId).mockResolvedValue(
      makeClient({
        access_end_date: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      }),
    );

    const result = await guardActiveClient(makeCtx());
    expect(result).toHaveProperty("client");
  });

  it("уже истёкший клиент получает сообщение без UPDATE", async () => {
    const fromSpy = mockFrom({});
    vi.mocked(findClientByTelegramId).mockResolvedValue(
      makeClient({ status: "access_expired" }),
    );

    const result = await guardActiveClient(makeCtx());
    expect(result).toBe("t:client.access_expired");
    // Ни паузы, ни условного обновления не требуется
    expect(fromSpy).not.toHaveBeenCalledWith("plan_pauses");
    expect(fromSpy).not.toHaveBeenCalledWith("clients");
  });

  it("NULL access_end_date - бессрочный доступ, без запросов пауз", async () => {
    const fromSpy = mockFrom({});
    vi.mocked(findClientByTelegramId).mockResolvedValue(makeClient());

    const result = await guardActiveClient(makeCtx());
    expect(result).toHaveProperty("client");
    expect(fromSpy).not.toHaveBeenCalledWith("plan_pauses");
  });
});
