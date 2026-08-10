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

import { buildPostponeKeyboard } from "../evening-poll.js";

describe("buildPostponeKeyboard", () => {
  it("marks available days and busy days", () => {
    const rows = buildPostponeKeyboard([2, 3, 4, 6], [1, 6, 7], "ru");

    const texts = rows.flat().map((b) => b.text);
    expect(texts.some((t) => t.includes("✅"))).toBe(true);
    expect(texts.some((t) => t.includes("⛔"))).toBe(true);
  });

  it("carries the default evening source on move buttons", () => {
    const rows = buildPostponeKeyboard([2, 3, 4, 5], [], "ru");
    const moveButtons = rows.flat().filter((b) => b.callback_data.startsWith("postpone_move"));
    expect(moveButtons.length).toBeGreaterThan(0);
    expect(moveButtons[0].callback_data).toBe("postpone_move:2:evening");
  });

  it("carries the morning source on move buttons", () => {
    const rows = buildPostponeKeyboard([2, 3, 4, 5], [], "ru", "morning");
    const moveButtons = rows.flat().filter((b) => b.callback_data.startsWith("postpone_move"));
    expect(moveButtons[0].callback_data).toBe("postpone_move:2:morning");
  });

  it("always includes week editor and cancel buttons", () => {
    const rows = buildPostponeKeyboard([2], [], "ru");
    const data = rows.flat().map((b) => b.callback_data);
    expect(data).toContain("postpone_week:evening");
    expect(data).toContain("postpone_cancel");
  });
});