import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock("../../config.js", () => ({
  config: {
    telegram: { botToken: "test", webhookSecret: "test" },
    supabase: { url: "http://localhost:54321", serviceRoleKey: "test" },
    coachChatId: 0n,
    paymentBaseUrl: "",
    nodeEnv: "test",
    port: 3001,
    webhookPath: "/webhook",
  },
}));

vi.mock("../supabase-admin.js", () => ({
  supabaseAdmin: { from: mocks.mockFrom },
}));

import { truncateMessage, formatProgressMessage, formatTrendsMessage, formatExercise, getPreviousWorkoutLogs, isTodayWorkoutCompleted } from "../workout-utils.js";

function mockLogsQuery(rows: Array<Record<string, unknown>>, error: { message: string } | null = null) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    lt: vi.fn(() => builder),
    or: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => ({ data: rows, error })),
  };
  mocks.mockFrom.mockReturnValue(builder);
  return builder;
}

describe("truncateMessage", () => {
  const suffix = "\n\n⚠️ …";

  it("returns message unchanged if within limit", () => {
    const msg = "Short message";
    expect(truncateMessage(msg, suffix)).toBe(msg);
  });

  it("truncates long message at newline boundary", () => {
    const msg = "Line 1\nLine 2\n" + "x".repeat(5000);
    const result = truncateMessage(msg, suffix);
    expect(result.length).toBeLessThanOrEqual(4096);
    expect(result).toContain(suffix);
    expect(result).not.toContain("xxxx");
  });

  it("truncates at last newline before limit", () => {
    const msg = "A".repeat(4000) + "\n" + "B".repeat(200);
    const result = truncateMessage(msg, suffix);
    expect(result).not.toContain("\nB");
  });
});

describe("formatProgressMessage", () => {
  it("returns progress_none for empty array", () => {
    const result = formatProgressMessage([], "ru");
    expect(result).toBeTruthy();
  });

  it("formats done and remaining exercises", () => {
    const progress = [
      { exercise: "Squat", done: true },
      { exercise: "Bench", done: false },
    ];
    const result = formatProgressMessage(progress, "en");
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("formatExercise", () => {
  it("includes last time line when previous log present", () => {
    const ex = { name: "Присед", sets: "4", reps: "8", weight: "60" };
    const result = formatExercise(1, ex, "ru", { weight: 60, sets: 4, reps: "8" });
    expect(result).toContain("Прошлый раз");
    expect(result).toContain("60");
    expect(result).toContain("4×8");
  });

  it("omits last time line when no previous log", () => {
    const ex = { name: "Присед", sets: "4", reps: "8", weight: "60" };
    const result = formatExercise(1, ex, "ru", null);
    expect(result).not.toContain("Прошлый раз");
  });

  it("formats weight-only previous log", () => {
    const ex = { name: "Жим", sets: "3", reps: "10", weight: "40" };
    const result = formatExercise(1, ex, "ru", { weight: 40, sets: null, reps: null });
    expect(result).toContain("40 кг");
  });

  it("formats per-set reps list without sets multiplier", () => {
    const ex = { name: "Жим", sets: "3", reps: "10/10/10", weight: "40" };
    const result = formatExercise(1, ex, "ru", { weight: 40, sets: 3, reps: "10/10/10" });
    const lastLine = result.split("\n").find((l) => l.includes("Прошлый раз"));
    expect(lastLine).toContain("10/10/10");
    expect(lastLine).not.toContain("3×");
  });

  it("formats varying per-set reps list", () => {
    const ex = { name: "Тяга", sets: "3", reps: "8/7/6", weight: "60" };
    const result = formatExercise(1, ex, "ru", { weight: 60, sets: 3, reps: "8/7/6" });
    expect(result).toContain("8/7/6");
  });

  it("still formats ranges with sets multiplier", () => {
    const ex = { name: "Присед", sets: "3", reps: "8-10", weight: "60" };
    const result = formatExercise(1, ex, "ru", { weight: 60, sets: 3, reps: "8-10" });
    const lastLine = result.split("\n").find((l) => l.includes("Прошлый раз"));
    expect(lastLine).toContain("3×8-10");
  });

  it("shows bodyweight instead of 0 kg", () => {
    const ex = { name: "Отжимания", sets: "3", reps: "15", weight: "0" };
    const result = formatExercise(1, ex, "ru", { weight: 0, sets: 3, reps: "15" });
    const lastLine = result.split("\n").find((l) => l.includes("Прошлый раз"));
    expect(lastLine).toContain("вес тела");
    expect(lastLine).not.toContain("0 кг");
  });
});

describe("getPreviousWorkoutLogs", () => {
  const client = { id: "client-1", timezone: "Europe/Moscow" } as Parameters<typeof getPreviousWorkoutLogs>[0];

  it("returns empty map when no exercises requested", async () => {
    const builder = mockLogsQuery([]);
    const result = await getPreviousWorkoutLogs(client, []);
    expect(result.size).toBe(0);
    expect(builder.limit).not.toHaveBeenCalled();
  });

  it("matches exercises case-insensitively and takes the latest row", async () => {
    mockLogsQuery([
      { exercise: "жим штанги лёжа", date: "2026-07-27", sets: 5, reps: "8", weight: 62.5 },
      { exercise: "Жим штанги лёжа", date: "2026-07-20", sets: 4, reps: "8", weight: 60 },
      { exercise: "[SKIP]", date: "2026-07-28", sets: null, reps: null, weight: null },
      { exercise: "Становая тяга", date: "2026-07-21", sets: 3, reps: "5", weight: 100 },
    ]);
    const result = await getPreviousWorkoutLogs(client, ["Жим Штанги Лёжа"]);
    const entry = result.get("жим штанги лёжа");
    expect(entry).toBeDefined();
    expect(entry?.weight).toBe(62.5);
    expect(entry?.sets).toBe(5);
    expect(result.size).toBe(1);
  });

  it("ignores unrelated exercises not in the plan", async () => {
    mockLogsQuery([
      { exercise: "Присед", date: "2026-07-20", sets: 4, reps: "8", weight: 80 },
    ]);
    const result = await getPreviousWorkoutLogs(client, ["Жим лёжа"]);
    expect(result.size).toBe(0);
  });

  it("queries with client_id filter, before-today and ordered by date desc", async () => {
    const builder = mockLogsQuery([]);
    await getPreviousWorkoutLogs(client, ["Присед"]);
    expect(builder.eq).toHaveBeenCalledWith("client_id", "client-1");
    expect(builder.lt).toHaveBeenCalledWith("date", expect.any(String));
    expect(builder.or).toHaveBeenCalledWith("exercise.ilike.присед");
    expect(builder.order).toHaveBeenCalledWith("date", { ascending: false });
  });

  it("escapes reserved and wildcard characters in or-filter", async () => {
    const builder = mockLogsQuery([]);
    await getPreviousWorkoutLogs(client, [
      "Жим лёжа (узкий хват)",
      "Тяга 50%",
      "Подтягивания с весом, 5кг",
    ]);
    expect(builder.or).toHaveBeenCalledWith(
      'exercise.ilike."жим лёжа (узкий хват)",exercise.ilike.тяга 50\\%,exercise.ilike."подтягивания с весом, 5кг"',
    );
  });

  it("degrades gracefully when query fails", async () => {
    mockLogsQuery([], { message: "boom" });
    const result = await getPreviousWorkoutLogs(client, ["Присед"]);
    expect(result.size).toBe(0);
  });
});

describe("isTodayWorkoutCompleted", () => {
  const client = {
    id: "client-1",
    program_id: "prog-1",
    timezone: "Europe/Moscow",
  } as Parameters<typeof isTodayWorkoutCompleted>[0];

  const workout = {
    week_number: 3,
    is_deload: false,
    goal: null,
    day_name: "Понедельник",
    days: [],
    exercises: [{ name: "Присед" }, { name: "Жим лёжа" }],
  } as Parameters<typeof isTodayWorkoutCompleted>[1];

  function mockTodayLogs(rows: Array<{ exercise?: string | null }>, error: { message: string } | null = null) {
    const eq2 = vi.fn(() => ({ data: rows, error }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const select = vi.fn(() => ({ eq: eq1 }));
    mocks.mockFrom.mockReturnValue({ select });
    return { select, eq1, eq2 };
  }

  it("returns false when only some exercises are logged", async () => {
    mockTodayLogs([{ exercise: "Присед" }]);
    expect(await isTodayWorkoutCompleted(client, workout)).toBe(false);
  });

  it("returns false without making a query when workout has no exercises", async () => {
    mocks.mockFrom.mockClear();
    await isTodayWorkoutCompleted(client, { ...workout, exercises: [] });
    expect(mocks.mockFrom).not.toHaveBeenCalled();
  });

  it("trims names on both sides", async () => {
    mockTodayLogs([{ exercise: "  Присед " }, { exercise: "жим лёжа" }]);
    expect(await isTodayWorkoutCompleted(client, {
      ...workout,
      exercises: [{ name: " Присед " }, { name: "Жим лёжа" }],
    })).toBe(true);
  });

  it("returns true when every exercise is logged today", async () => {
    mockTodayLogs([{ exercise: "Присед" }, { exercise: "жим лёжа" }]);
    expect(await isTodayWorkoutCompleted(client, workout)).toBe(true);
  });

  it("matches case-insensitively and ignores pseudo rows", async () => {
    mockTodayLogs([{ exercise: "присед" }, { exercise: "[SKIP]" }, { exercise: "ЖИМ ЛЁЖА" }]);
    expect(await isTodayWorkoutCompleted(client, workout)).toBe(true);
  });

  it("returns false when query fails", async () => {
    mockTodayLogs([], { message: "boom" });
    expect(await isTodayWorkoutCompleted(client, workout)).toBe(false);
  });

  it("returns false when no program is assigned", async () => {
    expect(await isTodayWorkoutCompleted({ ...client, program_id: null }, workout)).toBe(false);
  });

  it("filters today's logs by client and date", async () => {
    const { eq1, eq2 } = mockTodayLogs([]);
    await isTodayWorkoutCompleted(client, workout);
    expect(eq1).toHaveBeenCalledWith("client_id", "client-1");
    expect(eq2).toHaveBeenCalledWith("date", expect.any(String));
  });
});

describe("formatTrendsMessage", () => {
  it("returns trends_empty for empty array", () => {
    const result = formatTrendsMessage([], "ru");
    expect(result).toBeTruthy();
  });

  it("formats single measurement", () => {
    const trends = [
      { date: "2026-07-01", weight: 80, waist: 85, abdomen: 90, chest: 100, hips: 95, body_fat: 18 },
    ];
    const result = formatTrendsMessage(trends, "en");
    expect(result).toContain("80");
  });

  it("formats delta between two measurements", () => {
    const trends = [
      { date: "2026-07-08", weight: 79, waist: 84, abdomen: 89, chest: 100, hips: 95, body_fat: 17 },
      { date: "2026-07-01", weight: 80, waist: 85, abdomen: 90, chest: 100, hips: 95, body_fat: 18 },
    ];
    const result = formatTrendsMessage(trends, "en");
    expect(result).toContain("79");
    expect(result).toContain("80");
  });
});
