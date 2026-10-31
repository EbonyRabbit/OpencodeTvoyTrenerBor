import { describe, it, expect, vi } from "vitest";

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

import { buildPrLines, getStepPrompt, safePrLines } from "../wizard.js";

describe("getStepPrompt required flags", () => {
  it("pace and heart_rate are optional (skip button)", () => {
    expect(getStepPrompt("pace", "ru").required).toBe(false);
    expect(getStepPrompt("heart_rate", "ru").required).toBe(false);
    expect(getStepPrompt("pace", "en").required).toBe(false);
    expect(getStepPrompt("heart_rate", "en").required).toBe(false);
  });

  it("core cardio steps stay required", () => {
    expect(getStepPrompt("duration", "ru").required).toBe(true);
    expect(getStepPrompt("distance", "ru").required).toBe(true);
  });

  it("strength and AMRAP steps stay required", () => {
    expect(getStepPrompt("sets", "ru").required).toBe(true);
    expect(getStepPrompt("reps", "ru").required).toBe(true);
    expect(getStepPrompt("weight", "ru").required).toBe(true);
    expect(getStepPrompt("rpe", "ru").required).toBe(true);
    expect(getStepPrompt("rounds", "ru").required).toBe(true);
  });

  it("comment step stays optional", () => {
    expect(getStepPrompt("comment", "ru").required).toBe(false);
  });
});

describe("buildPrLines", () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    exercise: "Приседания со штангой",
    weight: 100,
    reps: "5/5/5",
    ...overrides,
  });

  it("reports a new record above the previous best", () => {
    const lines = buildPrLines([row()], new Map([["приседания со штангой", 110]]), "ru");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Новый рекорд");
    expect(lines[0]).toContain("116.7");
  });

  it("skips an equal or worse result", () => {
    expect(buildPrLines(
      [row({ weight: 90 })],
      new Map([["приседания со штангой", 110]]),
      "ru",
    )).toEqual([]);
  });

  it("skips the first result", () => {
    expect(buildPrLines([row()], new Map(), "ru")).toEqual([]);
  });

  it("skips assisted, bodyweight and rep-range entries", () => {
    expect(buildPrLines([
      row({ exercise: "Подтягивания в гравитроне" }),
      row({ weight: 0 }),
      row({ reps: "5-8" }),
    ], new Map([
      ["подтягивания в гравитроне", 1],
      ["приседания со штангой", 1],
    ]), "ru")).toEqual([]);
  });

  it("skips a generically named assisted exercise using equipment", () => {
    expect(buildPrLines(
      [row({ exercise: "Подтягивания", weight: 50 })],
      new Map([["подтягивания", 1]]),
      "ru",
      new Map([["подтягивания", "Гравитрон"]]),
    )).toEqual([]);
  });

  it("does not block the summary when the previous-best query fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(safePrLines([row()], Promise.reject(new Error("boom")), "ru")).resolves.toEqual([]);
    warn.mockRestore();
  });

  it("limits the summary to three records", () => {
    const rows = ["A", "B", "C", "D"].map((exercise, i) => row({ exercise, weight: 50 + i * 10 }));
    const best = new Map(rows.map((r) => [r.exercise.toLowerCase(), 1]));
    expect(buildPrLines(rows, best, "ru")).toHaveLength(3);
  });
});
