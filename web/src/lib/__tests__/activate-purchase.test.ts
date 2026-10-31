import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {},
}));

vi.mock("@/lib/telegram", () => ({
  sendTelegramMessage: vi.fn(),
}));

vi.mock("@/lib/plan-adjustment", () => ({
  generateSchedule: vi.fn(),
}));

import {
  buildActivationCoachMessage,
  toFiniteNumber,
} from "@/lib/activate-purchase";

const NOW = "2026-08-20T10:00:00.000Z";

describe("toFiniteNumber", () => {
  it("normalizes numeric strings and plain numbers", () => {
    expect(toFiniteNumber(5900)).toBe(5900);
    expect(toFiniteNumber("5900.50")).toBe(5900.5);
  });

  it("rejects empty, malformed, hex and exponent strings", () => {
    expect(toFiniteNumber("")).toBeNull();
    expect(toFiniteNumber("   ")).toBeNull();
    expect(toFiniteNumber("abc")).toBeNull();
    expect(toFiniteNumber("0x10")).toBeNull();
    expect(toFiniteNumber("1e3")).toBeNull();
    expect(toFiniteNumber(null)).toBeNull();
    expect(toFiniteNumber(undefined)).toBeNull();
  });
});

describe("buildActivationCoachMessage", () => {
  it("omits the amount line when it equals the price", () => {
    const message = buildActivationCoachMessage({
      clientName: "Иван",
      telegramId: null,
      contact: null,
      programTitle: "Сила",
      price: 5900,
      amount: 5900,
      durationWeeks: 12,
      accessEndDate: NOW,
    });
    expect(message).not.toContain("Сумма оплаты:");
  });

  it("omits contact and price lines when absent", () => {
    const message = buildActivationCoachMessage({
      clientName: "Иван",
      telegramId: null,
      contact: null,
      programTitle: "Сила",
      price: null,
      amount: null,
      durationWeeks: 4,
      accessEndDate: NOW,
    });
    expect(message).not.toContain("Цена:");
    expect(message).not.toContain("Сумма оплаты:");
    expect(message).not.toContain("Контакт:");
    expect(message).not.toContain("TG ID");
  });
});
