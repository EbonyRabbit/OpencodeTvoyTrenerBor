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
    publicUrl: "",
  },
}));

vi.mock("../lib/supabase-admin.js", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { finalizeSchedule } from "../training-days.js";

describe("finalizeSchedule", () => {
  it("sorts the selected days regardless of toggle order", () => {
    expect(finalizeSchedule([1, 6, 5])).toEqual([1, 5, 6]);
  });

  it("sorts newly toggled days together with retained ones", () => {
    expect(finalizeSchedule([1, 6, 5, 2])).toEqual([1, 2, 5, 6]);
  });

  it("sorts the global schedule", () => {
    expect(finalizeSchedule([5, 1, 3])).toEqual([1, 3, 5]);
  });
});