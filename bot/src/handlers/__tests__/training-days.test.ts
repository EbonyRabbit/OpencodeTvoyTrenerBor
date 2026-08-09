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
  it("keeps the position order when saving a week override", () => {
    // Wed content moved to Sat: [1,6,5] must survive, otherwise the
    // postponed day silently relocates to Friday on the editor save.
    expect(finalizeSchedule([1, 6, 5], "week-1")).toEqual([1, 6, 5]);
  });

  it("appends newly toggled days after retained ones", () => {
    expect(finalizeSchedule([1, 6, 5, 2], "week-1")).toEqual([1, 6, 5, 2]);
  });

  it("sorts the global schedule", () => {
    expect(finalizeSchedule([5, 1, 3], null)).toEqual([1, 3, 5]);
  });
});