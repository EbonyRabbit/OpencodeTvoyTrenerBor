import { describe, it, expect, vi } from "vitest";

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

vi.mock("../lib/supabase-admin.js", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { countMonth, type MonthPlan } from "../my-stats.js";

// Week 1: 2026-08-03 (Mon) .. 2026-08-09 (Sun)
const PLAN: MonthPlan = {
  schedule: [
    {
      week_number: 1,
      start_date: "2026-08-03",
      end_date: "2026-08-09",
      is_deload: false,
      focus: null,
    },
  ],
  weekDays: new Map([
    [
      1,
      new Map([
        [1, ["присед", "жим лёжа"]],
        [2, ["тяга"]],
      ]),
    ],
  ]),
  dayOrderByDate: new Map([
    [
      1,
      new Map([
        ["2026-08-03", 1],
        ["2026-08-05", 2],
      ]),
    ],
  ]),
};

function row(date: string, exercise: string, extra: { week?: number | null; day_order?: number | null } = {}): {
  date: string;
  exercise: string;
  week: number | null;
  day_order: number | null;
  rpe: number | null;
} {
  return { date, exercise, week: null, day_order: null, rpe: null, ...extra };
}

describe("countMonth", () => {
  it("counts a fully logged day via stored day_order", () => {
    const result = countMonth(
      [
        row("2026-08-03", "Присед", { week: 1, day_order: 1 }),
        row("2026-08-03", "Жим лёжа", { week: 1, day_order: 1 }),
      ],
      PLAN,
      null,
    );
    expect(result.completedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
  });

  it("does not count a partial day", () => {
    const result = countMonth([row("2026-08-03", "Присед", { week: 1, day_order: 1 })], PLAN, null);
    expect(result.completedCount).toBe(0);
  });

  it("counts legacy rows without day_order via the planned date when training_days are absent", () => {
    const result = countMonth(
      [
        row("2026-08-03", "Присед", { week: 1 }),
        row("2026-08-03", "жим лёжа", { week: 1 }),
      ],
      PLAN,
      null,
    );
    expect(result.completedCount).toBe(1);
  });

  it("counts legacy skip on the planned date as skipped", () => {
    const result = countMonth(
      [row("2026-08-03", "[SKIP]", { week: 1 })],
      PLAN,
      null,
    );
    expect(result.completedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
  });

  it("prefers stored day_order over the training_days derivation", () => {
    const result = countMonth(
      [
        row("2026-08-03", "Присед", { week: 1, day_order: 2 }),
        row("2026-08-03", "Жим лёжа", { week: 1, day_order: 2 }),
      ],
      PLAN,
      [1, 3],
    );
    // stored order points at day 2 (Тяга) whose names do not match the logs
    expect(result.completedCount).toBe(0);
  });

  it("collects rpe only from real exercises", () => {
    const result = countMonth(
      [
        row("2026-08-03", "Присед", { week: 1, day_order: 1, rpe: 7 }),
        row("2026-08-03", "Жим лёжа", { week: 1, day_order: 1 }),
      ],
      PLAN,
      null,
    );
    expect(result.rpeValues).toEqual([7]);
  });
});
