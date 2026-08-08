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
  it("has Russian menu and button translations", () => {
    expect(t("menu.progress", "ru")).toBe("/progress — замеры тела и динамика");
    expect(t("progress.title", "ru")).toBe("Прогресс и замеры:");
    expect(t("progress.dynamics_button", "ru")).toBe("📊 Динамика");
  });

  it("has English menu and button translations", () => {
    expect(t("menu.progress", "en")).toBe("/progress — measurements and dynamics");
    expect(t("progress.title", "en")).toBe("Progress and measurements:");
    expect(t("progress.dynamics_button", "en")).toBe("📊 Dynamics");
  });
});

describe("consent i18n", () => {
  it("has Russian consent translations", () => {
    expect(t("client.consent_title", "ru")).toContain("Согласие");
    expect(t("client.consent_text", "ru", { privacyUrl: "https://x/privacy" })).toContain("https://x/privacy");
    expect(t("client.consent_text", "ru", { privacyUrl: "https://x/privacy" })).not.toContain("{{privacyUrl}}");
    expect(t("client.consent_accept", "ru")).toBe("✅ Принимаю согласие");
    expect(t("client.consent_accepted", "ru")).toContain("Согласие принято");
    expect(t("client.consent_required", "ru")).toContain("кнопку");
  });

  it("has English consent translations with the privacy link", () => {
    expect(t("client.consent_title", "en")).toBe("📋 Consent to data processing");
    expect(t("client.consent_text", "en", { privacyUrl: "https://x/privacy" })).toContain("https://x/privacy");
    expect(t("client.consent_text", "en", { privacyUrl: "https://x/privacy" })).not.toContain("{{privacyUrl}}");
    expect(t("client.consent_accept", "en")).toBe("✅ I accept");
    expect(t("client.consent_accepted", "en")).toContain("Consent accepted");
    expect(t("client.consent_required", "en")).toContain("button");
  });

  it("does not leak raw placeholders in consent_text", () => {
    expect(t("client.consent_text", "ru", { privacyUrl: "https://x/privacy" })).not.toContain("{{");
    expect(t("client.consent_text", "en", { privacyUrl: "https://x/privacy" })).not.toContain("{{");
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
