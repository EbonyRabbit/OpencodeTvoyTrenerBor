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

vi.mock("@/lib/plan-adjustment", () => ({
  generateSchedule: vi.fn().mockResolvedValue({ error: null }),
}));

import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendTelegramMessage } from "@/lib/telegram";
import { verifySession } from "@/lib/dal";
import { generateSchedule } from "@/lib/plan-adjustment";
import { activateProgram, generateConnectCode, markPurchased, sendProgramInstructions } from "../actions";

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
};

beforeEach(() => {
  vi.clearAllMocks();
  (verifySession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    profile: { id: COACH_ID, role: "admin" },
  });
  (sendTelegramMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  (generateSchedule as unknown as ReturnType<typeof vi.fn>).mockReset();
  (generateSchedule as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null });
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
    (generateSchedule as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      error: "boom",
    });

    const result = await markPurchased(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toContain("не удалось создать расписание");
    expect(result.programAssigned).toBe(true);
    expect(result.connectCode).toBeUndefined();
    expect(
      updates.some(
        (u) => u.table === "clients" && (u.payload as { connect_code?: string }).connect_code,
      ),
    ).toBe(false);
  });

  it("clears the old schedule and pauses when reassigning even if program_id is null", async () => {
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
    (generateSchedule as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ error: null });

    const result = await markPurchased(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toBeUndefined();
    expect(deletedTables).toContain("program_schedule");
    expect(deletedTables).toContain("plan_pauses");
  });

  it("reports programAssigned when the schedule reset fails", async () => {
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
        delete: vi.fn(() => {
          if (table === "program_schedule") {
            return { eq: vi.fn(() => Promise.resolve({ error: { message: "boom" } })) };
          }
          return { eq: vi.fn(() => Promise.resolve({ error: null })) };
        }),
        insert: vi.fn(() => Promise.resolve({ error: null })),
      };
      return chain;
    });

    const result = await markPurchased(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toContain("сбросить старое расписание");
    expect(result.programAssigned).toBe(true);
  });

  it("reports a partial reset failure when only plan_pauses deletion fails", async () => {
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
        delete: vi.fn(() => {
          if (table === "plan_pauses") {
            return { eq: vi.fn(() => Promise.resolve({ error: { message: "boom" } })) };
          }
          return { eq: vi.fn(() => Promise.resolve({ error: null })) };
        }),
        insert: vi.fn(() => Promise.resolve({ error: null })),
      };
      return chain;
    });

    const result = await markPurchased(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toContain("сбросить паузы плана");
    expect(result.programAssigned).toBe(true);
  });

  it("sends instructions to a connected client on a successful purchase", async () => {
    mockDb({ client: { ...baseClient, telegram_id: 12345 }, program: baseProgram });

    const result = await markPurchased(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toBeUndefined();
    expect(result.warning).toBeUndefined();
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
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

  it("returns programAssigned when the schedule creation fails", async () => {
    mockDb({ client: { ...baseClient, payment_status: "paid" }, program: baseProgram });
    (generateSchedule as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      error: "boom",
    });

    const result = await activateProgram(CLIENT_ID, PROGRAM_ID);
    expect(result.error).toContain("не удалось создать расписание");
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

  it("deletes the old schedule when a program is reassigned", async () => {
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
    expect(deletedTables).toContain("program_schedule");
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