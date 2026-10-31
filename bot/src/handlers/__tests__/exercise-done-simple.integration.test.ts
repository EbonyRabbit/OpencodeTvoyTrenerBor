import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseAdmin } from "../../lib/supabase-admin.js";
import { getTodayISODay } from "../../lib/workout-utils.js";
import { handleExerciseDoneSimple, showExercise } from "../callbacks.js";
import { handleExerciseHistory } from "../exercise-history.js";
import { clearExerciseLibraryCache } from "../exercise-info.js";
import type { MyContext } from "../../bot.js";
import { resetDb } from "../../test/integration/db.js";

vi.mock("../../bot.js", () => ({
  bot: { api: { sendMessage: vi.fn().mockResolvedValue({}) } },
}));

function dateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function seedClientWithProgram() {
  const todayIso = getTodayISODay("UTC") || 1;
  const { data: program, error: programError } = await supabaseAdmin
    .from("programs")
    .insert({
      title: "Сила Новичка",
      price: 5900,
      duration_weeks: 12,
      active: true,
      type: "template",
      parsed_content: {
        version: 1,
        weeks: [
          {
            week_number: 1,
            is_deload: false,
            days: [
              {
                day_name: "Пн",
                day_order: 1,
                focus: "Сила",
                exercises: [
                  {
                    name: "Мобилизация + активация",
                    block: "Разминка",
                    sets: "1",
                    reps: "10 мин",
                  },
                  {
                    name: "Приседания со штангой",
                    block: "Сила",
                    sets: "4",
                    reps: "8",
                    weight: "80",
                  },
                ],
              },
            ],
          },
        ],
      },
    })
    .select("id")
    .single();
  if (programError || !program) {
    throw programError ?? new Error("program seed failed");
  }

  const { data: client, error: clientError } = await supabaseAdmin
    .from("clients")
    .insert({
      name: "Test Client",
      telegram_id: 999,
      timezone: "UTC",
      program_id: program.id,
    })
    .select("id")
    .single();
  if (clientError || !client) {
    throw clientError ?? new Error("client seed failed");
  }

  const { error: scheduleError } = await supabaseAdmin
    .from("program_schedule")
    .insert({
      client_id: client.id,
      week_number: 1,
      start_date: dateOffset(-3),
      end_date: dateOffset(3),
      is_deload: false,
      focus: "Сила",
      training_days: [todayIso],
    });
  if (scheduleError) throw scheduleError;

  return { clientId: client.id, programId: program.id };
}

function makeCtx(clientId: string, programId: string): MyContext {
  return {
    from: { id: 999, language_code: "ru" },
    language: "ru",
    client: { id: clientId, timezone: "UTC", program_id: programId },
    state: null,
    reply: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  } as unknown as MyContext;
}

function keyboardJson(ctx: MyContext): string {
  const options = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as
    | { reply_markup?: unknown }
    | undefined;
  return JSON.stringify(options?.reply_markup ?? {});
}

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
});

describe("warmup one-tap (phase 25)", () => {
  it("shows one cursor-friendly button for warmup and keeps the work-card buttons", async () => {
    const { clientId, programId } = await seedClientWithProgram();
    const warmupCtx = makeCtx(clientId, programId);
    await showExercise(warmupCtx, 0);
    expect(keyboardJson(warmupCtx)).toContain("exercise_done_simple:0");
    expect(keyboardJson(warmupCtx)).not.toContain("exercise_log:");
    expect(keyboardJson(warmupCtx)).not.toContain("exercise_swap:");
    expect(keyboardJson(warmupCtx)).not.toContain("exercise_history:");

    const workCtx = makeCtx(clientId, programId);
    await showExercise(workCtx, 1);
    expect(keyboardJson(workCtx)).toContain("exercise_log:1");
    expect(keyboardJson(workCtx)).toContain("exercise_swap:1");
    expect(keyboardJson(workCtx)).toContain("exercise_history:1");
    expect(keyboardJson(workCtx)).not.toContain("exercise_done_simple");
    const workText = String((workCtx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(workText).toContain("Цель: 80 кг × 8");
  });

  it("writes the warmup payload to workout_logs and advances to the next exercise", async () => {
    const { clientId, programId } = await seedClientWithProgram();
    const ctx = makeCtx(clientId, programId);

    await handleExerciseDoneSimple(ctx, "0");

    const { data: logs, error } = await supabaseAdmin
      .from("workout_logs")
      .select("*")
      .eq("client_id", clientId);
    expect(error).toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs?.[0]).toMatchObject({
      client_id: clientId,
      week: 1,
      day_order: 1,
      exercise: "Мобилизация + активация",
      sets: 1,
      reps: null,
      weight: null,
      rpe: null,
    });
    expect(typeof logs?.[0].date).toBe("string");

    const calls = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls;
    expect(String(calls.at(-1)?.[0])).toContain("Приседания со штангой");
  });

  it("does not write a log when a work exercise is tapped", async () => {
    const { clientId, programId } = await seedClientWithProgram();
    const ctx = makeCtx(clientId, programId);

    await handleExerciseDoneSimple(ctx, "1");

    const { count, error } = await supabaseAdmin
      .from("workout_logs")
      .select("id", { count: "exact", head: true });
    expect(error).toBeNull();
    expect(count).toBe(0);
    expect(ctx.reply).toHaveBeenCalled();
  });
});

describe("phase 29 target and history", () => {
  it("raises the target after all planned sets hit the top", async () => {
    const { clientId, programId } = await seedClientWithProgram();
    await supabaseAdmin.from("exercises").insert({
      name: "Приседания со штангой",
      name_key: "приседаниясоштангой",
      muscle_group: "Ноги",
      equipment: "Штанга",
    });
    clearExerciseLibraryCache();
    await supabaseAdmin.from("workout_logs").insert({
      client_id: clientId,
      date: dateOffset(-1),
      week: 1,
      day_order: 1,
      exercise: "Приседания со штангой",
      sets: 4,
      reps: "8/8/8/8",
      weight: 80,
    });

    const ctx = makeCtx(clientId, programId);
    await showExercise(ctx, 1);
    const text = String((ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(text).toContain("Цель: 82.5 кг × 8");
    expect(text).toContain("Прошлый раз");
  });

  it("shows today's log in exercise history", async () => {
    const { clientId, programId } = await seedClientWithProgram();
    await supabaseAdmin.from("workout_logs").insert({
      client_id: clientId,
      date: dateOffset(0),
      week: 1,
      day_order: 1,
      exercise: "Приседания со штангой",
      sets: 4,
      reps: "8/8/8/8",
      weight: 80,
    });

    const ctx = makeCtx(clientId, programId);
    await handleExerciseHistory(ctx, "1");
    const text = String((ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(text).toContain("История: Приседания со штангой");
    expect(text).toContain("Лучший");
    expect(text).toMatch(/\d{2}\.\d{2}/);
  });
});
