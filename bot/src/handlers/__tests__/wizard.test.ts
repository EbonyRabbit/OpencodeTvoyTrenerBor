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

import { getStepPrompt } from "../wizard.js";

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
