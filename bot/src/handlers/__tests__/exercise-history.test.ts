import { beforeEach, describe, expect, it, vi } from "vitest";

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

const mocks = vi.hoisted(() => ({
  getTodayWorkout: vi.fn(),
  getExerciseHistory: vi.fn(),
}));

vi.mock("../../lib/workout-utils.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    getTodayWorkout: mocks.getTodayWorkout,
    getExerciseHistory: mocks.getExerciseHistory,
  };
});

import { handleExerciseHistory } from "../exercise-history.js";
import type { MyContext } from "../../bot.js";

function makeCtx(): MyContext {
  return {
    from: { id: 1, language_code: "ru" },
    language: "ru",
    client: { id: "client-1", timezone: "UTC" },
    reply: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  } as unknown as MyContext;
}

function workout(exercises: unknown[]) {
  return {
    week_number: 1,
    is_deload: false,
    goal: null,
    days: [],
    day_name: "Пн",
    day_order: 1,
    exercises,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleExerciseHistory", () => {
  it("shows the last entries and the best result", async () => {
    mocks.getTodayWorkout.mockResolvedValue(workout([{ name: "Приседания", sets: "3", reps: "5" }]));
    mocks.getExerciseHistory.mockResolvedValue([
      { date: "2026-10-20", weight: 100, sets: 3, reps: "5/5/5", rounds: null, duration_sec: null, distance_km: null, pace: null, heart_rate: null },
      { date: "2026-10-10", weight: 95, sets: 3, reps: "5/5/5", rounds: null, duration_sec: null, distance_km: null, pace: null, heart_rate: null },
    ]);
    const ctx = makeCtx();
    await handleExerciseHistory(ctx, "0");
    const sent = String((ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(sent).toContain("История: Приседания");
    expect(sent).toContain("20.10");
    expect(sent).toContain("Лучший");
    expect(mocks.getExerciseHistory).toHaveBeenCalledWith(ctx.client, "Приседания", 5);
  });

  it("shows a separate block for every superset child", async () => {
    mocks.getTodayWorkout.mockResolvedValue(workout([{
      name: "Грудь и спина",
      type: "superset",
      children: [{ name: "Жим" }, { name: "Тяга" }],
    }]));
    mocks.getExerciseHistory.mockResolvedValue([]);
    const ctx = makeCtx();
    await handleExerciseHistory(ctx, "0");
    const sent = String((ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(sent).toContain("История: Жим");
    expect(sent).toContain("История: Тяга");
    expect(sent).toContain("Пока нет записей");
  });

  it("uses the parent history for a circuit", async () => {
    mocks.getTodayWorkout.mockResolvedValue(workout([{
      name: "Круг",
      type: "circuit",
      children: [{ name: "Берпи" }],
    }]));
    mocks.getExerciseHistory.mockResolvedValue([
      { date: "2026-10-20", weight: null, sets: null, reps: null, rounds: 4, duration_sec: 900, distance_km: null, pace: null, heart_rate: null },
    ]);
    const ctx = makeCtx();
    await handleExerciseHistory(ctx, "0");
    const sent = String((ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(sent).toContain("История: Круг");
    expect(sent).toContain("4 раунд");
    expect(mocks.getExerciseHistory).toHaveBeenCalledTimes(1);
  });

  it("shows a service error when the log query fails", async () => {
    mocks.getTodayWorkout.mockResolvedValue(workout([{ name: "Приседания" }]));
    mocks.getExerciseHistory.mockRejectedValue(new Error("boom"));
    const ctx = makeCtx();
    await handleExerciseHistory(ctx, "0");
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("временно недоступен"));
  });

  it("rejects warmups and invalid indexes without querying history", async () => {
    mocks.getTodayWorkout.mockResolvedValue(workout([{ name: "Разминка", kind: "warmup" }]));
    const ctx = makeCtx();
    await handleExerciseHistory(ctx, "0");
    expect(mocks.getExerciseHistory).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(expect.objectContaining({ show_alert: true }));

    await handleExerciseHistory(ctx, "x");
    expect(mocks.getExerciseHistory).not.toHaveBeenCalled();
  });
});
