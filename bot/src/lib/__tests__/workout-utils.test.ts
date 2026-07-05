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

import { truncateMessage, formatProgressMessage, formatTrendsMessage } from "../workout-utils.js";

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
