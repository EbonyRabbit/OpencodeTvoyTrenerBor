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

vi.mock("../../lib/workout-utils.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    getTodayWorkout: (...args: unknown[]) =>
      (globalThis as Record<string, unknown>).__mockGetTodayWorkout?.(...args),
    isTodayWorkoutCompleted: vi.fn().mockResolvedValue(false),
    getPreviousWorkoutLogs: vi.fn().mockResolvedValue(new Map()),
  };
});

import { supabaseAdmin } from "../../lib/supabase-admin.js";
import { showExercise, handleExerciseDoneSimple } from "../callbacks.js";
import type { MyContext } from "../../bot.js";

function chain(result: { data: unknown; error: null | { message: string } }) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "or", "limit", "delete", "upsert", "insert", "maybeSingle"]) {
    c[m] = vi.fn().mockReturnValue(c);
  }
  c.then = (cb: (v: unknown) => unknown) => Promise.resolve(result).then(cb);
  return c;
}

function warmupWorkout() {
  return {
    week_number: 2,
    is_deload: false,
    goal: null,
    days: [],
    day_name: "Пн",
    day_order: 1,
    exercises: [
      { name: "Мобилизация + активация", block: "Разминка", sets: "1", reps: "10 мин" },
      { name: "Приседания со штангой", block: "Сила", sets: "4", reps: "8" },
    ],
  };
}

function makeCtx(): MyContext {
  return {
    from: { id: 999, language_code: "ru" },
    language: "ru" as never,
    client: { id: "client-9", timezone: "UTC", program_id: "prog-9" },
    state: null,
    reply: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  } as unknown as MyContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  fromMock.from.mockReturnValue(chain({ data: [], error: null }));
  (globalThis as Record<string, unknown>).__mockGetTodayWorkout = vi.fn().mockResolvedValue(warmupWorkout());
});

describe("warmup one-tap (phase 25)", () => {
  it("warmup card shows Сделал button, hides log/skip/swap", async () => {
    const ctx = makeCtx();
    await showExercise(ctx, 0);
    const kb = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.reply_markup?.inline_keyboard;
    const flat = JSON.stringify(kb);
    expect(flat).toContain("exercise_done_simple:0");
    expect(flat).not.toContain("exercise_log:");
    expect(flat).not.toContain("exercise_swap:");
  });

  it("work card keeps log/skip/swap buttons", async () => {
    const ctx = makeCtx();
    await showExercise(ctx, 1);
    const flat = JSON.stringify((ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.reply_markup?.inline_keyboard);
    expect(flat).toContain("exercise_log:1");
    expect(flat).toContain("exercise_swap:1");
    expect(flat).not.toContain("exercise_done_simple");
  });

  it("one tap writes sets=1 log and shows next", async () => {
    const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    const ctx = makeCtx();
    await handleExerciseDoneSimple(ctx, "0");
    expect(fromMock.from).toHaveBeenCalledWith("workout_logs");
    const calls = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const lastText = String(calls[calls.length - 1]?.[0]);
    expect(lastText).toContain("Приседания со штангой");
  });

  it("one tap on work exercise falls back to card", async () => {
    const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    const ctx = makeCtx();
    await handleExerciseDoneSimple(ctx, "1");
    expect(fromMock.from).not.toHaveBeenCalledWith("workout_logs");
  });
});
