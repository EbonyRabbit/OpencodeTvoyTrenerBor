import { describe, it, expect } from "vitest";
import {
  parseTelegramId,
  parseBuyParams,
  buildPurchaseCoachMessage,
} from "./purchase";
import { formatPrice as realFormatPrice } from "./format-price";

const fc = (v: string) => (/^\+?\d/.test(v) ? v : `@${v}`);
const fp = (p: number) => `${p} ₽`;

describe("parseTelegramId", () => {
  it("returns null for empty input", () => {
    expect(parseTelegramId("")).toBeNull();
    expect(parseTelegramId("   ")).toBeNull();
  });

  it("parses valid numeric ids", () => {
    expect(parseTelegramId("12345")).toBe(12345);
    expect(parseTelegramId("  123456789  ")).toBe(123456789);
  });

  it("returns null for invalid input", () => {
    expect(parseTelegramId("1234")).toBeNull();
    expect(parseTelegramId("1234567890123456")).toBeNull();
    expect(parseTelegramId("12345abc")).toBeNull();
    expect(parseTelegramId("12 345")).toBeNull();
  });
});

describe("parseBuyParams", () => {
  it("parses both tg id and username", () => {
    expect(parseBuyParams("123456789", "iurii")).toEqual({
      telegramId: 123456789,
      telegramUsername: "iurii",
    });
  });

  it("returns nulls for empty or invalid values", () => {
    expect(parseBuyParams("", "")).toEqual({ telegramId: null, telegramUsername: null });
    expect(parseBuyParams("abc", "bad username!")).toEqual({
      telegramId: null,
      telegramUsername: null,
    });
  });
});

describe("buildPurchaseCoachMessage", () => {
  const base = {
    programTitle: "Сушка 12 недель",
    price: 15000,
    durationWeeks: 12,
    name: "Иван",
    contact: "iurii",
    formatContact: fc,
    formatPrice: fp,
  };

  it("includes program, price, name and formatted contact", () => {
    const msg = buildPurchaseCoachMessage({ ...base, telegramId: 12345 });
    expect(msg).toContain("Программа: Сушка 12 недель");
    expect(msg).toContain("Цена: 15000 ₽");
    expect(msg).toContain("Длительность: 12 нед.");
    expect(msg).toContain("👤 Имя: Иван");
    expect(msg).toContain("📱 Контакт: @iurii");
    expect(msg).toContain("TG ID: 12345");
  });

  it("omits nick line when contact equals username", () => {
    const msg = buildPurchaseCoachMessage({ ...base, telegramUsername: "iurii", telegramId: null });
    expect(msg).toContain("📱 Контакт: @iurii");
    expect(msg).not.toContain("t.me/iurii");
  });

  it("adds nick link when contact differs from username", () => {
    const msg = buildPurchaseCoachMessage({
      ...base,
      contact: "+79161234567",
      telegramUsername: "iurii",
      telegramId: null,
    });
    expect(msg).toContain("📱 Контакт: +79161234567");
    expect(msg).toContain("🔗 @iurii (https://t.me/iurii)");
  });

  it("formats price with real ru-RU formatter (NBSP grouping)", () => {
    const msg = buildPurchaseCoachMessage({
      ...base,
      price: 15000,
      telegramId: null,
      formatPrice: realFormatPrice,
    });
    expect(msg).toContain(`Цена: 15\u00A0000`);
  });

  it("omits price line when price is null", () => {
    const msg = buildPurchaseCoachMessage({ ...base, price: null, telegramId: null });
    expect(msg).not.toContain("Цена:");
  });

  it("omits tg id line when id is null", () => {
    const msg = buildPurchaseCoachMessage({ ...base, telegramId: null });
    expect(msg).not.toContain("TG ID:");
  });
});