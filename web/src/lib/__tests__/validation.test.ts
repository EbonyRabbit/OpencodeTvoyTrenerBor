import { describe, expect, it } from "vitest";
import {
  isValidTelegramUsername,
  normalizeTelegramUsername,
  telegramDisplayName,
} from "../validation";

describe("telegram username helpers", () => {
  it("normalizes username by stripping @, trimming and lowercasing", () => {
    expect(normalizeTelegramUsername("  @Ivan_User  ")).toBe("ivan_user");
    expect(normalizeTelegramUsername("ivan")).toBe("ivan");
  });

  it("rejects invalid usernames", () => {
    expect(normalizeTelegramUsername("")).toBeNull();
    expect(normalizeTelegramUsername("ab")).toBeNull();
    expect(normalizeTelegramUsername("не_юзер")).toBeNull();
    expect(normalizeTelegramUsername("toolong_username_over_32_chars____")).toBeNull();
    expect(isValidTelegramUsername("bad-name")).toBe(false);
  });

  it("builds stable fallback from seed", () => {
    const seed = "123e4567-e89b-12d3-a456-426614174000";
    expect(telegramDisplayName(null, seed)).toBe(
      telegramDisplayName(null, seed),
    );
    expect(telegramDisplayName(null, seed)).toMatch(/^Клиент #[A-Z0-9]{6}$/);
    expect(telegramDisplayName("ivan", seed)).toBe("@ivan");
  });
});
