import { describe, it, expect } from "vitest";
import { resolveLanguage, t, applyClientLanguage } from "../../i18n/index.js";

describe("resolveLanguage", () => {
  it("returns 'en' for English language codes", () => {
    expect(resolveLanguage("en")).toBe("en");
    expect(resolveLanguage("en-US")).toBe("en");
    expect(resolveLanguage("en-GB")).toBe("en");
    expect(resolveLanguage("EN")).toBe("en");
  });

  it("returns 'ru' for Russian language codes", () => {
    expect(resolveLanguage("ru")).toBe("ru");
    expect(resolveLanguage("ru-RU")).toBe("ru");
  });

  it("returns 'ru' for undefined/unknown codes", () => {
    expect(resolveLanguage(undefined)).toBe("ru");
    expect(resolveLanguage("de")).toBe("ru");
    expect(resolveLanguage("fr")).toBe("ru");
    expect(resolveLanguage("")).toBe("ru");
  });
});

describe("t", () => {
  it("returns Russian translation by default", () => {
    const result = t("greeting.hello", undefined, { name: "Test" });
    expect(result).toContain("Test");
  });

  it("returns English translation when specified", () => {
    const result = t("greeting.hello", "en", { name: "Test" });
    expect(result).toContain("Test");
  });

  it("returns key for missing translation", () => {
    const result = t("nonexistent.key");
    expect(result).toBe("nonexistent.key");
  });
});

describe("progress menu i18n", () => {
  it("has Russian menu and progress translations", () => {
    expect(t("menu.progress", "ru")).toBe("/progress - прогресс тренировок");
    expect(t("progress.title", "ru")).toBe("Прогресс:");
  });

  it("has English menu and progress translations", () => {
    expect(t("menu.progress", "en")).toBe("/progress - training progress");
    expect(t("progress.title", "en")).toBe("Progress:");
  });
});

describe("consent i18n", () => {
  it("has Russian consent translations with 18+ confirmation", () => {
    expect(t("client.consent_title", "ru")).toContain("Согласие");
    const text = t("client.consent_text", "ru", { privacyUrl: "https://x/privacy" });
    expect(text).toContain("https://x/privacy");
    expect(text).toContain("18");
    expect(text).not.toContain("{{privacyUrl}}");
    expect(t("client.consent_accept", "ru")).toBe("✅ Принимаю согласие");
    expect(t("client.consent_accepted", "ru")).toContain("Согласие принято");
    expect(t("client.consent_required", "ru")).toContain("кнопку");
  });

  it("has English consent translations with 18+ confirmation and privacy link", () => {
    expect(t("client.consent_title", "en")).toBe("📋 Consent to data processing");
    const text = t("client.consent_text", "en", { privacyUrl: "https://x/privacy" });
    expect(text).toContain("https://x/privacy");
    expect(text).toContain("18");
    expect(text).not.toContain("{{privacyUrl}}");
    expect(t("client.consent_accept", "en")).toBe("✅ I accept");
    expect(t("client.consent_accepted", "en")).toContain("Consent accepted");
    expect(t("client.consent_required", "en")).toContain("button");
  });

  it("does not leak raw placeholders in consent_text", () => {
    expect(t("client.consent_text", "ru", { privacyUrl: "https://x/privacy" })).not.toContain("{{");
    expect(t("client.consent_text", "en", { privacyUrl: "https://x/privacy" })).not.toContain("{{");
  });

  it("has 18+ coach request policy texts", () => {
    expect(t("coach_request.policy", "ru", { privacyUrl: "https://x/privacy" })).toContain("18");
    expect(t("coach_request.policy", "en", { privacyUrl: "https://x/privacy" })).toContain("18");
  });
});

describe("morning postpone i18n", () => {
  it("has Russian morning postpone translations", () => {
    expect(t("morning.btn_postpone", "ru")).toContain("Перенести");
    expect(t("morning.postpone_prompt", "ru")).toContain("другой день");
  });

  it("has English morning postpone translations", () => {
    expect(t("morning.btn_postpone", "en")).toContain("Postpone");
    expect(t("morning.postpone_prompt", "en")).toContain("another day");
  });
});

describe("applyClientLanguage", () => {
  it("sets language to 'ru' for Russian client", () => {
    const ctx = { language: "en" as const };
    applyClientLanguage(ctx, "ru");
    expect(ctx.language).toBe("ru");
  });

  it("sets language to 'en' for English client", () => {
    const ctx = { language: "ru" as const };
    applyClientLanguage(ctx, "en");
    expect(ctx.language).toBe("en");
  });

  it("does not change language for null/undefined", () => {
    const ctx = { language: "ru" as const };
    applyClientLanguage(ctx, null);
    expect(ctx.language).toBe("ru");

    const ctx2 = { language: "ru" as const };
    applyClientLanguage(ctx2, undefined);
    expect(ctx2.language).toBe("ru");
  });

  it("does not change language for unknown language codes", () => {
    const ctx = { language: "ru" as const };
    applyClientLanguage(ctx, "de");
    expect(ctx.language).toBe("ru");
  });
});
