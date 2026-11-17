import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/dal", () => ({
  verifySession: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("@/lib/telegram", () => ({
  sendTelegramMessage: vi.fn(),
}));

vi.mock("@/lib/program-periods", () => ({
  startProgramPeriod: vi.fn().mockResolvedValue({}),
}));

import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendTelegramMessage } from "@/lib/telegram";
import { verifySession } from "@/lib/dal";
import { startProgramPeriod } from "@/lib/program-periods";
import { activateProgram, disableClient, generateConnectCode, markPurchased, sendProgramInstructions } from "../actions";

const CLIENT_ID = "11111111-2222-3333-4444-555555555555";
const PROGRAM_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const COACH_ID = "22222222-2222-2222-2222-222222222222";

type State = {
  client: Record<string, unknown> | null;
  program: Record<string, unknown> | null;
  updateError?: { message?: string } | null;
  insertError?: { message?: string } | null;
};

function mockDb(state: State) {
  const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  fake.from.mockImplementation((table: string) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(() =>
        Promise.resolve({
          data: table === "clients" ? state.client : table === "programs" ? state.program : null,
          error: null,
        }),
      ),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: state.updateError ?? null })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      })),
      insert: vi.fn(() => Promise.resolve({ error: state.insertError ?? null })),
    };
    return chain;
  });
}

const baseClient = {
  id: CLIENT_ID,
  name: "Иван",
  language: "ru",
  connect_code: null,
  program_id: null,
  timezone: "Europe/Moscow",
};

const baseProgram = {
  id: PROGRAM_ID,
  title: "Сила 12 недель",
  duration_weeks: 12,
  type: "template",
  client_id: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  (verifySession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    profile: { id: COACH_ID, role: "admin" },
  });
  (sendTelegramMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  (startProgramPeriod as unknown as ReturnType<typeof vi.fn>).mockReset();
  (startProgramPeriod as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
});

describe("markPurchased", () => {
  it("rejects roles other than admin and coach", async () => {
    (verifySession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      profile: { id: COACH_ID, role: "client" },
    });
    mockDb({ client: baseClient, program: baseProgram });

    const result = await markPurchased(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toBe("Нет прав");
  });

  it("returns an error for a non-UUID client id", async () => {
    mockDb({ client: baseClient, program: baseProgram });

    const result = await markPurchased("not-a-uuid", PROGRAM_ID);
    expect(result.error).toBe("Некорректный идентификатор");
  });

  it("returns an error when the client does not exist", async () => {
    mockDb({ client: null, program: baseProgram });

    const result = await markPurchased(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toBe("Клиент не найден");
  });

  it("sends instructions directly when the client is connected to telegram", async () => {
    mockDb({ client: { ...baseClient, telegram_id: 12345 }, program: baseProgram });

    const result = await markPurchased(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toBeUndefined();
    expect(result.connectCode).toBeUndefined();
    expect(result.warning).toBeUndefined();
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      12345,
      expect.stringContaining("Привет, Иван!"),
    );
  });

  it("returns connect code and a not-connected warning when the client has no telegram_id", async () => {
    mockDb({ client: { ...baseClient, connect_code: "OLD12345" }, program: baseProgram });

    const result = await markPurchased(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toBeUndefined();
    expect(result.connectCode).toBe("OLD12345");
    expect(result.warning).toContain("не подключён к Telegram");
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("generates a fresh connect code when the client has none", async () => {
    const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    const updates: Array<{ table: string; payload: unknown }> = [];
    fake.from.mockImplementation((table: string) => {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data: table === "clients" ? { ...baseClient, telegram_id: null } : baseProgram,
            error: null,
          }),
        ),
        update: vi.fn((payload: unknown) => {
          updates.push({ table, payload });
          return {
            eq: vi.fn(() => Promise.resolve({ error: null })),
          };
        }),
        delete: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ error: null })),
        })),
        insert: vi.fn(() => Promise.resolve({ error: null })),
      };
      return chain;
    });

    const result = await markPurchased(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toBeUndefined();
    expect(result.connectCode).toMatch(/^[A-Z0-9]{8}$/);
    expect(result.warning).toContain("не подключён к Telegram");
    expect(updates.some((u) => u.table === "clients" && (u.payload as { connect_code?: string }).connect_code)).toBe(true);
  });

  it("warns when the telegram delivery fails", async () => {
    mockDb({ client: { ...baseClient, telegram_id: 12345 }, program: baseProgram });
    (sendTelegramMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const result = await markPurchased(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toBeUndefined();
    expect(result.warning).toContain("не доставлены в Telegram");
  });

  it("warns when the messages insert fails but delivery still happens", async () => {
    mockDb({
      client: { ...baseClient, telegram_id: 12345 },
      program: baseProgram,
      insertError: { message: "boom" },
    });

    const result = await markPurchased(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toBeUndefined();
    expect(result.warning).toContain("не сохранены в истории");
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it("returns an error when the program is missing", async () => {
    mockDb({ client: baseClient, program: null });

    const result = await markPurchased(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toBe("Программа не найдена");
  });

  it("does not persist a connect code when the schedule creation fails", async () => {
    const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    const updates: Array<{ table: string; payload: unknown }> = [];
    fake.from.mockImplementation((table: string) => {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data: table === "clients" ? { ...baseClient, telegram_id: null } : baseProgram,
            error: null,
          }),
        ),
        update: vi.fn((payload: unknown) => {
          updates.push({ table, payload });
          return { eq: vi.fn(() => Promise.resolve({ error: null })) };
        }),
        delete: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ error: null })),
        })),
        insert: vi.fn(() => Promise.resolve({ error: null })),
      };
      return chain;
    });
    (startProgramPeriod as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      error: "Не удалось назначить программу и расписание.",
    });

    const result = await markPurchased(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toBe("Не удалось назначить программу и расписание.");
    expect(result.programAssigned).toBe(true);
    expect(result.connectCode).toBeUndefined();
    expect(
      updates.some(
        (u) => u.table === "clients" && (u.payload as { connect_code?: string }).connect_code,
      ),
    ).toBe(false);
  });

  it("runs the period switch when reassigning even if program_id is null", async () => {
    const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    const deletedTables: string[] = [];
    fake.from.mockImplementation((table: string) => {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data:
              table === "clients"
                ? { ...baseClient, program_id: null, telegram_id: null }
                : baseProgram,
            error: null,
          }),
        ),
        update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })),
        delete: vi.fn(() => {
          deletedTables.push(table);
          return { eq: vi.fn(() => Promise.resolve({ error: null })) };
        }),
        insert: vi.fn(() => Promise.resolve({ error: null })),
      };
      return chain;
    });

    const result = await markPurchased(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toBeUndefined();
    expect(startProgramPeriod).toHaveBeenCalledWith(CLIENT_ID, PROGRAM_ID);
    expect(deletedTables).not.toContain("program_schedule");
    expect(deletedTables).not.toContain("plan_pauses");
  });

  it("reports programAssigned when the period switch fails", async () => {
    const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    fake.from.mockImplementation((table: string) => {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data:
              table === "clients" ? { ...baseClient, program_id: null } : baseProgram,
            error: null,
          }),
        ),
        update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })),
        delete: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ error: null })),
        })),
        insert: vi.fn(() => Promise.resolve({ error: null })),
      };
      return chain;
    });

    (startProgramPeriod as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      error: "Не удалось назначить программу и расписание.",
    });

    const result = await markPurchased(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toBe("Не удалось назначить программу и расписание.");
    expect(result.programAssigned).toBe(true);
  });

  it("sends instructions to a connected client on a successful purchase", async () => {
    mockDb({ client: { ...baseClient, telegram_id: 12345 }, program: baseProgram });

    const result = await markPurchased(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toBeUndefined();
    expect(result.warning).toBeUndefined();
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it("rejects another client's program on purchase", async () => {
    mockDb({
      client: baseClient,
      program: {
        ...baseProgram,
        client_id: "22222222-2222-2222-2222-222222222222",
      },
    });

    const result = await markPurchased(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toBe("Программа принадлежит другому клиенту");
  });
});

describe("activateProgram", () => {
  it("rejects roles other than admin and coach", async () => {
    (verifySession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      profile: { id: COACH_ID, role: "client" },
    });
    mockDb({ client: { ...baseClient, payment_status: "paid" }, program: baseProgram });

    const result = await activateProgram(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toBe("Нет прав");
  });

  it("returns programAssigned when the period switch fails", async () => {
    mockDb({ client: { ...baseClient, payment_status: "paid" }, program: baseProgram });
    (startProgramPeriod as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      error: "Не удалось назначить программу и расписание.",
    });

    const result = await activateProgram(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toBe("Не удалось назначить программу и расписание.");
    expect(result.programAssigned).toBe(true);
    expect(result.connectCode).toBeUndefined();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("requires the payment to be confirmed", async () => {
    mockDb({ client: { ...baseClient, payment_status: "pending" }, program: baseProgram });

    const result = await activateProgram(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toBe("Сначала подтвердите оплату");
  });

  it("returns an error when the program is missing", async () => {
    mockDb({ client: { ...baseClient, payment_status: "paid" }, program: null });

    const result = await activateProgram(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toBe("Программа не найдена");
  });

  it("runs the period switch instead of deleting the old schedule when reassigning", async () => {
    const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    const deletedTables: string[] = [];
    fake.from.mockImplementation((table: string) => {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data:
              table === "clients"
                ? { ...baseClient, payment_status: "paid", program_id: "old-program" }
                : baseProgram,
            error: null,
          }),
        ),
        update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })),
        delete: vi.fn(() => {
          deletedTables.push(table);
          return { eq: vi.fn(() => Promise.resolve({ error: null })) };
        }),
        insert: vi.fn(() => Promise.resolve({ error: null })),
      };
      return chain;
    });

    const result = await activateProgram(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toBeUndefined();
    expect(startProgramPeriod).toHaveBeenCalledWith(CLIENT_ID, PROGRAM_ID);
    expect(deletedTables).not.toContain("program_schedule");
  });

  it("sends instructions to a connected client on a successful activation", async () => {
    mockDb({
      client: { ...baseClient, payment_status: "paid", telegram_id: 12345 },
      program: baseProgram,
    });

    const result = await activateProgram(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toBeUndefined();
    expect(result.warning).toBeUndefined();
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      12345,
      expect.stringContaining("Привет, Иван!"),
    );
  });

  it("returns an error for a non-UUID client id", async () => {
    mockDb({ client: { ...baseClient, payment_status: "paid" }, program: baseProgram });

    const result = await activateProgram("not-a-uuid", PROGRAM_ID);
    expect(result.error).toBe("Некорректный идентификатор");
  });

  it("rejects another client's personal program", async () => {
    mockDb({
      client: { ...baseClient, payment_status: "paid" },
      program: {
        ...baseProgram,
        type: "personal",
        client_id: "22222222-2222-2222-2222-222222222222",
      },
    });

    const result = await activateProgram(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toBe("Программа принадлежит другому клиенту");
  });
});

describe("sendProgramInstructions", () => {
  it("requires a program to be assigned", async () => {
    mockDb({ client: { ...baseClient, program_id: null, payment_status: "paid" }, program: baseProgram });

    const result = await sendProgramInstructions(CLIENT_ID);
    expect(result.error).toBe("Сначала назначьте программу");
  });

  it("requires the payment to be confirmed", async () => {
    mockDb({
      client: { ...baseClient, program_id: PROGRAM_ID, payment_status: "pending" },
      program: baseProgram,
    });

    const result = await sendProgramInstructions(CLIENT_ID);
    expect(result.error).toBe("Сначала подтвердите оплату");
  });

  it("sends instructions to a connected client", async () => {
    mockDb({
      client: { ...baseClient, program_id: PROGRAM_ID, payment_status: "paid", telegram_id: 12345 },
      program: baseProgram,
    });

    const result = await sendProgramInstructions(CLIENT_ID);
    expect(result.error).toBeUndefined();
    expect(result.warning).toBeUndefined();
    expect(result.connectCode).toBeUndefined();
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      12345,
      expect.stringContaining("Привет, Иван!"),
    );
  });

  it("returns a connect code for a client without telegram_id", async () => {
    mockDb({
      client: { ...baseClient, program_id: PROGRAM_ID, payment_status: "paid", telegram_id: null },
      program: baseProgram,
    });

    const result = await sendProgramInstructions(CLIENT_ID);
    expect(result.error).toBeUndefined();
    expect(result.warning).toContain("не подключён к Telegram");
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("returns an error for a non-UUID client id", async () => {
    mockDb({
      client: { ...baseClient, program_id: PROGRAM_ID, payment_status: "paid" },
      program: baseProgram,
    });

    const result = await sendProgramInstructions("not-a-uuid");
    expect(result.error).toBe("Некорректный идентификатор");
  });
});

describe("generateConnectCode", () => {
  it("returns an error when the client does not exist", async () => {
    mockDb({ client: null, program: baseProgram });

    const result = await generateConnectCode(CLIENT_ID);
    expect(result.error).toBe("Клиент не найден");
  });

  it("generates and returns a code for an existing client", async () => {
    const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    fake.from.mockImplementation((table: string) => {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        maybeSingle: vi.fn(() =>
          Promise.resolve({ data: table === "clients" ? baseClient : null, error: null }),
        ),
        update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })),
        insert: vi.fn(() => Promise.resolve({ error: null })),
      };
      return chain;
    });

    const result = await generateConnectCode(CLIENT_ID);
    expect(result.error).toBeUndefined();
    expect(result.code).toMatch(/^[A-Z0-9]{8}$/);
  });
});
describe("disableClient 30.8: подписка гасится вместе с доступом", () => {
  function mockDbForDisable(subError?: { message: string } | null) {
    const calls: { table: string; method: string; args: unknown[] }[] = [];
    const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
    const fake = supabaseAdmin as unknown as {
      from: ReturnType<typeof vi.fn>;
      rpc: ReturnType<typeof vi.fn>;
    };
    (fake as unknown as { rpc: unknown }).rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ error: null });
    });
    fake.from.mockImplementation((table: string) => {
      const chain: Record<string, unknown> = {};
      const record = (method: string) => (...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      };
      for (const m of [
        "select",
        "eq",
        "neq",
        "is",
        "in",
        "update",
        "delete",
        "insert",
        "order",
        "range",
        "limit",
        "maybeSingle",
      ]) {
        chain[m] = record(m);
      }
      const outcome = subError && table === "subscriptions"
        ? { data: null, error: subError }
        : { data: table === "clients" ? { status: "active" } : null, error: null };
      (chain as { then: unknown }).then = (
        onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
      ) => Promise.resolve(outcome).then(onFulfilled);
      return chain;
    });
    return { calls, rpcCalls };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    (verifySession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      profile: { id: COACH_ID, role: "admin" },
    });
  });

  it("отключение гасит живую подписку и закрывает период", async () => {
    const { calls, rpcCalls } = mockDbForDisable();

    const result = await disableClient(CLIENT_ID);

    expect(result.error).toBeUndefined();
    expect(rpcCalls).toContainEqual({
      fn: "close_active_period",
      args: { p_client_id: CLIENT_ID },
    });

    const subUpdate = calls.find(
      (c) => c.table === "subscriptions" && c.method === "update",
    );
    expect(subUpdate?.args?.[0]).toEqual({ status: "cancelled" });
    const subFilters = calls.filter(
      (c) =>
        c.table === "subscriptions" &&
        (c.method === "eq" || c.method === "in"),
    );
    expect(subFilters).toEqual(
      expect.arrayContaining([
        { table: "subscriptions", method: "eq", args: ["client_id", CLIENT_ID] },
        {
          table: "subscriptions",
          method: "in",
          args: ["status", ["active", "past_due"]],
        },
      ]),
    );

    const clientUpdate = calls.find(
      (c) => c.table === "clients" && c.method === "update",
    );
    expect(clientUpdate?.args?.[0]).toMatchObject({
      status: "inactive",
      program_id: null,
      access_start_date: null,
      access_end_date: null,
    });
  });

  it("ошибка отмены подписки - disable падает и статус не трогает", async () => {
    const { calls } = mockDbForDisable({ message: "connection reset" });

    const result = await disableClient(CLIENT_ID);

    expect(result.error).toContain("Не удалось отменить подписку");
    const clientUpdate = calls.filter(
      (c) => c.table === "clients" && c.method === "update",
    );
    expect(clientUpdate).toHaveLength(0);
  });

  it("клиент не найден - подписку не трогаем", async () => {
    const { calls } = mockDbForDisable(null);
    const fake = supabaseAdmin as unknown as {
      from: ReturnType<typeof vi.fn>;
    };
    fake.from.mockImplementation((table: string) => {
      if (table === "clients") {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
        return chain;
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await disableClient(CLIENT_ID);

    expect(result.error).toBe("Клиент не найден");
    expect(calls.filter((c) => c.table === "subscriptions")).toHaveLength(0);
  });
});
