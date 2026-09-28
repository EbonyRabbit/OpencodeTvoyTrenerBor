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

const { mockGetTodayWorkout } = vi.hoisted(() => ({ mockGetTodayWorkout: vi.fn() }));

vi.mock("../../lib/workout-utils.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    getTodayWorkout: mockGetTodayWorkout,
    isTodayWorkoutCompleted: vi.fn().mockResolvedValue(false),
    getPreviousWorkoutLogs: vi.fn().mockResolvedValue([]),
    formatSingleExercise: vi.fn().mockReturnValue("EX"),
    collectLoggableNames: vi.fn().mockReturnValue(["Приседания со штангой"]),
    truncateMessage: vi.fn().mockImplementation((t: string) => t),
    loadExerciseLibraryRows: vi.fn(),
  };
});

import { supabaseAdmin } from "../../lib/supabase-admin.js";
import {
  handleSwapOpen,
  handleSwapPick,
  handleSwapRevert,
  handleSwapBack,
} from "../exercise-swap.js";
import type { MyContext } from "../../bot.js";

function chain(result: { data: unknown; error: null | { message: string } }) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "or", "limit", "delete", "upsert", "maybeSingle"]) {
    c[m] = vi.fn().mockReturnValue(c);
  }
  c.then = (cb: (v: unknown) => unknown) => Promise.resolve(result).then(cb);
  return c;
}

function makeCtx(stateData: unknown = {}): MyContext {
  return {
    from: { id: 777, language_code: "ru" },
    language: "ru" as never,
    client: { id: "client-1", program_id: "prog-1" },
    state: { action: "today", step: "viewing", data: stateData } as never,
    reply: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  } as unknown as MyContext;
}

function todayWorkout() {
  return {
    week_number: 1,
    is_deload: false,
    goal: null,
    days: [],
    day_name: "Пн",
    day_order: 1,
    exercises: [{ name: "Приседания со штангой", sets: "4", reps: "8" }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTodayWorkout.mockResolvedValue(todayWorkout());
});

describe("handleSwapOpen", () => {
  it("shows candidates from same muscle group", async () => {
    const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    fromMock.from
      .mockReturnValueOnce(chain({ data: { equipment: "Штанга" }, error: null }))
      .mockReturnValueOnce(chain({ data: [{ id: "o", muscle_group: "Ноги" }], error: null }))
      .mockReturnValueOnce(
        chain({ data: [{ id: "b", name: "Жим ногами", muscle_group: "Ноги", equipment: "Тренажёр" }], error: null }),
      )
      .mockReturnValue(chain({ data: [], error: null }));
    const ctx = makeCtx();
    await handleSwapOpen(ctx, "0");
    const sent = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(String(sent)).toContain("Приседания со штангой");
    const kb = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.reply_markup?.inline_keyboard;
    expect(JSON.stringify(kb)).toContain("swap_pick:0:-1:b");
  });

  it("falls back to exercise view when no match", async () => {
    const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    fromMock.from
      .mockReturnValueOnce(chain({ data: { equipment: null }, error: null }))
      .mockReturnValue(chain({ data: [], error: null }));
    const ctx = makeCtx();
    await handleSwapOpen(ctx, "0");
    const calls = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls;
    expect(String(calls[0]?.[0])).toContain("не нашёл замену");
    expect(calls.length).toBeGreaterThan(1);
  });
});

describe("handleSwapPick", () => {
  it("saves swap and refreshes exercise", async () => {
    const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    fromMock.from
      .mockReturnValueOnce(chain({ data: { name: "Жим ногами" }, error: null }))
      .mockReturnValue(chain({ data: null, error: null }));
    const ctx = makeCtx();
    await handleSwapPick(ctx, "0:-1:00000000-0000-4000-8000-00000000000b");
    const calls = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls;
    expect(String(calls[0]?.[0])).toContain("Жим ногами");
    expect(fromMock.from).toHaveBeenCalledWith("client_exercise_swaps");
  });

  it("rejects bad uuid", async () => {
    const ctx = makeCtx();
    await handleSwapPick(ctx, "0:-1:not-a-uuid");
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});

describe("handleSwapRevert / handleSwapBack", () => {
  it("reverts and refreshes", async () => {
    const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    fromMock.from.mockReturnValue(chain({ data: null, error: null }));
    const ctx = makeCtx();
    await handleSwapRevert(ctx, "0:-1");
    expect(String((ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).toContain("Вернул");
  });

  it("back shows exercise", async () => {
    const ctx = makeCtx();
    await handleSwapBack(ctx, "0");
    expect(ctx.reply).toHaveBeenCalled();
  });
});
