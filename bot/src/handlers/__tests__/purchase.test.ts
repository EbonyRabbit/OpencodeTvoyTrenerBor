import { describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    telegram: { botToken: "test", webhookSecret: "test" },
    supabase: { url: "http://127.0.0.1:54321", serviceRoleKey: "test" },
    coachChatId: 0n,
    prodamusPayformBaseUrl: "https://pay.demo.prodamus.ru/payment",
    clientPortalUrl: "https://portal.example.com",
    nodeEnv: "test",
    port: 3001,
    webhookPath: "/webhook",
    publicUrl: "",
  },
}));

vi.mock("../../lib/supabase-admin.js", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { buildPurchaseCoachMessage } from "../purchase.js";

describe("buildPurchaseCoachMessage", () => {
  it("includes name, username link, program and price", () => {
    const msg = buildPurchaseCoachMessage({
      firstName: "Иван",
      lastName: "Петров",
      username: "buyer",
      telegramId: 123456789,
      programTitle: "Сила Новичка",
      price: 9900,
    });
    expect(msg).toContain("🛒 Заявка на покупку");
    expect(msg).toContain("Программа: Сила Новичка");
    expect(msg).toContain(`Цена: 9\u00A0900 ₽`);
    expect(msg).toContain("👤 Иван Петров");
    expect(msg).toContain("🔗 @buyer (https://t.me/buyer)");
    expect(msg).toContain("🆔 TG ID: 123456789");
  });

  it("handles missing username and last name", () => {
    const msg = buildPurchaseCoachMessage({
      firstName: "Иван",
      lastName: null,
      username: null,
      telegramId: 123456789,
      programTitle: "Сила Новичка",
      price: 9900,
    });
    expect(msg).toContain("👤 Иван");
    expect(msg).not.toContain("@");
    expect(msg).toContain("🆔 TG ID: 123456789");
  });

  it("omits price line when price is null", () => {
    const msg = buildPurchaseCoachMessage({
      firstName: "Иван",
      lastName: null,
      username: null,
      telegramId: 1,
      programTitle: "P",
      price: null,
    });
    expect(msg).not.toContain("Цена:");
  });
});
