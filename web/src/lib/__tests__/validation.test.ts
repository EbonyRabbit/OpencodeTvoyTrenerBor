import { describe, expect, it } from "vitest";
import { formatContact } from "../validation";

describe("formatContact", () => {
  it("keeps an existing username prefix", () => {
    expect(formatContact("@buyer")).toBe("@buyer");
  });

  it("adds a username prefix", () => {
    expect(formatContact("buyer")).toBe("@buyer");
  });

  it("keeps numeric Telegram ids and phones bare", () => {
    expect(formatContact("123456789")).toBe("123456789");
    expect(formatContact("+7 999 123-45-67")).toBe("+7 999 123-45-67");
  });
});
