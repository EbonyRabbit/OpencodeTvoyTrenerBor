import { describe, it, expect } from "vitest";
import { buildBuyUrl, buildProgramRequestCoachMessage } from "../../lib/program-links.js";

describe("buildBuyUrl", () => {
  it("includes tg id and encoded username", () => {
    const url = buildBuyUrl("https://shop.example.com", "prog-1", 123456789, "iurii");
    expect(url).toBe("https://shop.example.com/buy/prog-1?tg=123456789&u=iurii");
  });

  it("omits username param when username is null", () => {
    const url = buildBuyUrl("https://shop.example.com", "prog-1", 123456789, null);
    expect(url).toBe("https://shop.example.com/buy/prog-1?tg=123456789");
  });

  it("encodes special characters in username", () => {
    const url = buildBuyUrl("https://shop.example.com", "prog-1", 123456789, "a b&c");
    expect(url).toBe("https://shop.example.com/buy/prog-1?tg=123456789&u=a%20b%26c");
  });
});

describe("buildProgramRequestCoachMessage", () => {
  it("includes name, username link and tg id", () => {
    const msg = buildProgramRequestCoachMessage({
      clientName: "Иван",
      telegramId: 123456789,
      username: "iurii",
      programTitle: "Сушка",
    });
    expect(msg).toContain("👤 Иван");
    expect(msg).toContain("🔗 @iurii (https://t.me/iurii)");
    expect(msg).toContain("🆔 TG ID: 123456789");
    expect(msg).toContain("Хочет: Сушка");
  });

  it("still shows tg id when username is missing", () => {
    const msg = buildProgramRequestCoachMessage({
      clientName: "Иван",
      telegramId: 123456789,
      username: null,
      programTitle: "Сушка",
    });
    expect(msg).toContain("🆔 TG ID: 123456789");
    expect(msg).not.toContain("@");
  });
});