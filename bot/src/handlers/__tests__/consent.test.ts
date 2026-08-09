import { describe, it, expect, vi } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    telegram: { botToken: "test", webhookSecret: "test" },
    supabase: { url: "http://localhost:54321", serviceRoleKey: "test" },
    coachChatId: 0n,
    paymentBaseUrl: "",
    clientPortalUrl: "https://portal.example.com",
    nodeEnv: "test",
    port: 3001,
    webhookPath: "/webhook",
    publicUrl: "",
  },
}));

import {
  PRIVACY_POLICY_VERSION,
  buildConsentMessage,
  buildConsentKeyboard,
  buildPrivacyUrl,
} from "../consent.js";

describe("buildPrivacyUrl", () => {
  it("builds the privacy URL from the configured portal URL", () => {
    expect(buildPrivacyUrl()).toBe("https://portal.example.com/privacy");
  });
});

describe("PRIVACY_POLICY_VERSION", () => {
  it("is a date-like version string", () => {
    expect(PRIVACY_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("buildConsentMessage", () => {
  it("renders Russian consent with the privacy link", () => {
    const text = buildConsentMessage("ru");
    expect(text).toContain("Согласие на обработку данных");
    expect(text).toContain("https://portal.example.com/privacy");
    expect(text).not.toContain("{{");
  });

  it("renders English consent with the privacy link", () => {
    const text = buildConsentMessage("en");
    expect(text).toContain("Consent to data processing");
    expect(text).toContain("https://portal.example.com/privacy");
    expect(text).not.toContain("{{");
  });
});

describe("buildConsentKeyboard", () => {
  it("uses the consent_accept callback", () => {
    const keyboard = buildConsentKeyboard("ru");
    expect(keyboard.inline_keyboard[0][0].callback_data).toBe("consent_accept");
  });

  it("labels the button in the client language", () => {
    expect(buildConsentKeyboard("ru").inline_keyboard[0][0].text).toBe("✅ Принимаю согласие");
    expect(buildConsentKeyboard("en").inline_keyboard[0][0].text).toBe("✅ I accept");
  });
});
