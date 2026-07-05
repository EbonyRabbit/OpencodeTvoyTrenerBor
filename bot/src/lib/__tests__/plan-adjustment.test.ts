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

import { suggestStrategy } from "../plan-adjustment.js";

describe("suggestStrategy", () => {
  it("returns 'skip' for 0-2 days", () => {
    expect(suggestStrategy(0)).toBe("skip");
    expect(suggestStrategy(1)).toBe("skip");
    expect(suggestStrategy(2)).toBe("skip");
  });

  it("returns 'shift' for 3-4 days", () => {
    expect(suggestStrategy(3)).toBe("shift");
    expect(suggestStrategy(4)).toBe("shift");
  });

  it("returns 'deload' for 5-7 days", () => {
    expect(suggestStrategy(5)).toBe("deload");
    expect(suggestStrategy(6)).toBe("deload");
    expect(suggestStrategy(7)).toBe("deload");
  });

  it("returns 'rollback' for 8+ days", () => {
    expect(suggestStrategy(8)).toBe("rollback");
    expect(suggestStrategy(14)).toBe("rollback");
    expect(suggestStrategy(30)).toBe("rollback");
  });
});
