import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("../training-days.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../training-days.js")>();
  return { ...actual, startTrainingDaysSetup: vi.fn(() => Promise.resolve(true)) };
});

import { supabaseAdmin } from "../../lib/supabase-admin.js";
import { handlePostponeMove, handlePostponeWeek, handleMorningPostpone } from "../evening-poll.js";
import { startTrainingDaysSetup } from "../training-days.js";
import { hasCompletionLogs, hasSkipLog } from "../../cron/evening-scheduler.js";
import { getOccupiedDaysForWeek } from "../../lib/workout-utils.js";
import type { MyContext } from "../../bot.js";

type Row = Record<string, unknown>;

const PROGRAM_WITH_NAMED_DAYS = {
  id: "program-1",
  parsed_content: {
    version: 1,
    weeks: [
      {
        week_number: 2,
        week_label: "Неделя 2",
        days: [
          { day_order: 1, day_name: "Понедельник", exercises: [{ name: "Присед" }] },
          { day_order: 2, day_name: "Среда", exercises: [{ name: "Тяга" }] },
        ],
      },
    ],
  },
};

type DbCall = { table: string; method: string; args: unknown[] };

let dbCalls: DbCall[] = [];

function buildDb(rows: { schedule?: Row[]; program?: Row | null }): void {
  dbCalls = [];
  const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };

  const scheduleData = rows.schedule ?? [];
  const programData = rows.program ?? null;

  function chain(data: () => Row[] | Row | null, table: string) {
    const tbl = {
      eq: (...args: unknown[]) => {
        dbCalls.push({ table, method: "eq", args });
        return tbl;
      },
      maybeSingle: vi.fn(() => Promise.resolve({ data: data(), error: null })),
      then: (onFulfilled: (v: unknown) => void) => onFulfilled({ data: data(), error: null }),
    };
    return tbl;
  }

  fake.from.mockImplementation((table: string) => {
    if (table === "program_schedule") {
      return {
        select: (...args: unknown[]) => {
          dbCalls.push({ table, method: "select", args });
          return chain(() => scheduleData, table);
        },
        update: (...args: unknown[]) => {
          dbCalls.push({ table, method: "update", args });
          return chain(() => null, table);
        },
        insert: (...args: unknown[]) => {
          dbCalls.push({ table, method: "insert", args });
          return Promise.resolve({ data: null, error: null });
        },
      };
    }
    if (table === "programs") {
      return {
        select: (...args: unknown[]) => {
          dbCalls.push({ table, method: "select", args });
          return chain(() => programData, table);
        },
      };
    }
    return {
      select: (...args: unknown[]) => {
        dbCalls.push({ table, method: "select", args });
        return chain(() => [], table);
      },
      insert: (...args: unknown[]) => {
        dbCalls.push({ table, method: "insert", args });
        return Promise.resolve({ data: null, error: null });
      },
    };
  });
}

function weekRow(override: Record<string, unknown> = {}): Row {
  return {
    id: "week-2",
    week_number: 2,
    start_date: "2026-08-10",
    end_date: "2026-08-16",
    is_deload: false,
    focus: null,
    training_days: null,
    ...override,
  };
}

function makeCtx(overrides: Record<string, unknown> = {}): MyContext {
  return {
    from: { id: 452161486 },
    callbackQuery: { id: "cb-1" },
    client: {
      id: "client-1",
      program_id: "program-1",
      timezone: "Europe/Moscow",
      language: "ru",
      training_days: null,
    },
    answerCallbackQuery: vi.fn(() => Promise.resolve()),
    editMessageText: vi.fn(() => Promise.resolve()),
    reply: vi.fn(() => Promise.resolve()),
    ...overrides,
  } as unknown as MyContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(new Date("2026-08-10T12:00:00Z"));
});

describe("handlePostponeMove", () => {
  it("legacy button without source suffix logs [EVENING_POSTPONE]", async () => {
    buildDb({ schedule: [weekRow({ training_days: [1] })] });
    const ctx = makeCtx();

    const result = await handlePostponeMove(ctx, "3");

    expect(result).toBe(true);
    const updateCall = dbCalls.find((c) => c.table === "program_schedule" && c.method === "update");
    expect((updateCall?.args[0] as Row).training_days).toEqual([3]);
    expect(dbCalls.some((c) => c.method === "eq" && c.args[0] === "id" && c.args[1] === "week-2")).toBe(true);
    const insertCall = dbCalls.find((c) => c.table === "workout_logs" && c.method === "insert");
    const insertRow = insertCall?.args[0] as Row;
    expect(insertRow.exercise).toBe("[EVENING_POSTPONE]");
    expect(insertRow.client_id).toBe("client-1");
    expect(insertRow.date).toBe("2026-08-10");
    expect(insertRow.week).toBe(2);
    expect(ctx.editMessageText).toHaveBeenCalled();
  });

  it("morning-sourced button logs [MORNING_POSTPONE]", async () => {
    buildDb({ schedule: [weekRow({ training_days: [1] })] });
    const ctx = makeCtx();

    await handlePostponeMove(ctx, "3:morning");

    const insertCall = dbCalls.find((c) => c.table === "workout_logs" && c.method === "insert");
    expect((insertCall?.args[0] as Row).exercise).toBe("[MORNING_POSTPONE]");
  });

  it("garbage source suffix falls back to evening", async () => {
    buildDb({ schedule: [weekRow({ training_days: [1] })] });
    const ctx = makeCtx();

    await handlePostponeMove(ctx, "3:garbage");

    const insertCall = dbCalls.find((c) => c.table === "workout_logs" && c.method === "insert");
    expect((insertCall?.args[0] as Row).exercise).toBe("[EVENING_POSTPONE]");
  });

  it("rejects non-integer and out-of-range target days", async () => {
    buildDb({ schedule: [weekRow({ training_days: [1] })] });

    for (const bad of ["0", "8", "abc", ""]) {
      const ctx = makeCtx();
      const result = await handlePostponeMove(ctx, bad);
      expect(result).toBe(false);
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
        expect.objectContaining({ show_alert: true }),
      );
      expect(dbCalls.some((c) => c.method === "update")).toBe(false);
    }
  });

  it("refuses to move into an occupied day", async () => {
    buildDb({ schedule: [weekRow({ training_days: [1, 3] })] });
    const ctx = makeCtx();

    const result = await handlePostponeMove(ctx, "3");

    expect(result).toBe(false);
    expect(dbCalls.some((c) => c.method === "update")).toBe(false);
  });
});

describe("handlePostponeWeek", () => {
  it("legacy button (empty params) opens the week editor with evening header", async () => {
    buildDb({ schedule: [weekRow({ training_days: [1] })] });
    const ctx = makeCtx();

    const result = await handlePostponeWeek(ctx, "");

    expect(result).toBe(true);
    expect(startTrainingDaysSetup).toHaveBeenCalledWith(ctx, { id: "week-2", trainingDays: [1] });
    const edited = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(edited).toContain("Тренировка сегодня была?");
  });

  it("morning-sourced button uses the morning header", async () => {
    buildDb({ schedule: [weekRow({ training_days: [1] })] });
    const ctx = makeCtx();

    await handlePostponeWeek(ctx, "morning");

    const edited = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(edited).toContain("другой день");
  });
});

describe("handleMorningPostpone (M1: no training days)", () => {
  it("opens the picker for clients whose days are derived from program day names", async () => {
    buildDb({ schedule: [weekRow()], program: PROGRAM_WITH_NAMED_DAYS });
    const ctx = makeCtx();

    const result = await handleMorningPostpone(ctx);

    expect(result).toBe(true);
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining("другой день"),
      expect.objectContaining({
        reply_markup: expect.objectContaining({
          inline_keyboard: expect.arrayContaining([
            expect.arrayContaining([
              expect.objectContaining({ callback_data: expect.stringContaining("postpone_move:") }),
            ]),
          ]),
        }),
      }),
    );
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalledWith(
      expect.objectContaining({ show_alert: true, text: expect.stringContaining("занят") }),
    );
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalledWith(
      expect.objectContaining({ show_alert: true, text: expect.stringContaining("Перенос недоступен") }),
    );
  });

  it("opens the picker for generator-style day names like 'Понедельник | Грудь'", async () => {
    buildDb({
      schedule: [weekRow()],
      program: {
        id: "program-1",
        parsed_content: {
          version: 1,
          weeks: [
            {
              week_number: 2,
              week_label: "Неделя 2",
              days: [
                { day_order: 1, day_name: "Понедельник | Грудь", exercises: [{ name: "Жим лёжа" }] },
                { day_order: 2, day_name: "Среда | Спина", exercises: [{ name: "Тяга" }] },
              ],
            },
          ],
        },
      },
    });
    const ctx = makeCtx();

    const result = await handleMorningPostpone(ctx);

    expect(result).toBe(true);
    const editedCall = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(editedCall[0]).toContain("другой день");
    const keyboard = editedCall[1]?.reply_markup?.inline_keyboard as Array<
      Array<{ text: string; callback_data: string }>
    >;
    expect(keyboard.some((row) => row.some((b) => b.callback_data.startsWith("postpone_move")))).toBe(true);
    expect(keyboard.some((row) => row.some((b) => b.text.includes("⛔")))).toBe(true);
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalledWith(
      expect.objectContaining({ show_alert: true }),
    );
  });
});

describe("getOccupiedDaysForWeek", () => {
  it("falls back to program day names when no training days exist", async () => {
    buildDb({ schedule: [weekRow()], program: PROGRAM_WITH_NAMED_DAYS });
    const client = {
      id: "client-1",
      program_id: "program-1",
      timezone: "Europe/Moscow",
      language: "ru",
      training_days: null,
    } as unknown as Parameters<typeof getOccupiedDaysForWeek>[0];

    const occupied = await getOccupiedDaysForWeek(client, weekRow() as never);

    expect(occupied).toEqual([1, 3]);
  });

  it("matches real generator day names with suffixes", async () => {
    buildDb({
      schedule: [weekRow()],
      program: {
        id: "program-1",
        parsed_content: {
          version: 1,
          weeks: [
            {
              week_number: 2,
              week_label: "Неделя 2",
              days: [
                { day_order: 1, day_name: "Понедельник | Грудь", exercises: [{ name: "Жим" }] },
                { day_order: 2, day_name: "Среда | Спина", exercises: [{ name: "Тяга" }] },
              ],
            },
          ],
        },
      },
    });
    const client = {
      id: "client-1",
      program_id: "program-1",
      timezone: "Europe/Moscow",
      language: "ru",
      training_days: null,
    } as unknown as Parameters<typeof getOccupiedDaysForWeek>[0];

    const occupied = await getOccupiedDaysForWeek(client, weekRow() as never);

    expect(occupied).toEqual([1, 3]);
  });

  it("sorts by day_order, not by JSON order", async () => {
    buildDb({
      schedule: [weekRow()],
      program: {
        id: "program-1",
        parsed_content: {
          version: 1,
          weeks: [
            {
              week_number: 2,
              week_label: "Неделя 2",
              days: [
                { day_order: 2, day_name: "Среда", exercises: [{ name: "Тяга" }] },
                { day_order: 1, day_name: "Понедельник", exercises: [{ name: "Жим" }] },
              ],
            },
          ],
        },
      },
    });
    const client = {
      id: "client-1",
      program_id: "program-1",
      timezone: "Europe/Moscow",
      language: "ru",
      training_days: null,
    } as unknown as Parameters<typeof getOccupiedDaysForWeek>[0];

    const occupied = await getOccupiedDaysForWeek(client, weekRow() as never);

    expect(occupied).toEqual([1, 3]);
  });

  it("returns [] when the week has no start_date and no training days", async () => {
    buildDb({ schedule: [weekRow({ start_date: null, end_date: null })], program: PROGRAM_WITH_NAMED_DAYS });
    const client = {
      id: "client-1",
      program_id: "program-1",
      timezone: "Europe/Moscow",
      language: "ru",
      training_days: null,
    } as unknown as Parameters<typeof getOccupiedDaysForWeek>[0];

    const occupied = await getOccupiedDaysForWeek(
      client,
      weekRow({ start_date: null, end_date: null }) as never,
    );

    expect(occupied).toEqual([]);
  });

  it("prefers the week override over client days", async () => {
    buildDb({ schedule: [weekRow({ training_days: [4] })] });
    const client = {
      id: "client-1",
      program_id: "program-1",
      timezone: "Europe/Moscow",
      language: "ru",
      training_days: [2],
    } as unknown as Parameters<typeof getOccupiedDaysForWeek>[0];

    const occupied = await getOccupiedDaysForWeek(client, weekRow({ training_days: [4] }) as never);

    expect(occupied).toEqual([4]);
  });
});

describe("evening scheduler log checks", () => {
  it("treats postpones and poll answers as non-completions", () => {
    expect(hasCompletionLogs([{ exercise: "[MORNING_POSTPONE]" }])).toBe(false);
    expect(hasCompletionLogs([{ exercise: "[EVENING_POSTPONE]" }])).toBe(false);
    expect(hasCompletionLogs([{ exercise: "[EVENING_YES]" }])).toBe(false);
    expect(hasCompletionLogs([{ exercise: "[SKIP]" }])).toBe(false);
    expect(hasCompletionLogs([{ exercise: "Присед" }])).toBe(true);
    expect(hasCompletionLogs([{ exercise: "   " }])).toBe(false);
    expect(hasCompletionLogs([{ exercise: "" }])).toBe(false);
    expect(hasCompletionLogs([])).toBe(false);
  });

  it("detects skip logs", () => {
    expect(hasSkipLog([{ exercise: "[SKIP]" }])).toBe(true);
    expect(hasSkipLog([{ exercise: "[MORNING_POSTPONE]" }])).toBe(false);
  });
});