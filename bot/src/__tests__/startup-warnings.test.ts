import { describe, it, expect } from "vitest";
import { startupWarnings } from "../startup-warnings.js";

describe("startupWarnings", () => {
  it("returns no warnings when both URLs are set", () => {
    const warnings = startupWarnings({
      clientPortalUrl: "https://portal.example.com",
      prodamusPayformBaseUrl: "https://pay.demo.prodamus.ru/payment",
    });
    expect(warnings).toEqual([]);
  });

  it("warns when CLIENT_PORTAL_URL is empty", () => {
    const warnings = startupWarnings({
      clientPortalUrl: "",
      prodamusPayformBaseUrl: "https://pay.demo.prodamus.ru/payment",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("CLIENT_PORTAL_URL");
    expect(warnings[0]).toContain("/myweb");
  });

  it("warns when PRODAMUS_PAYFORM_BASE_URL is empty", () => {
    const warnings = startupWarnings({
      clientPortalUrl: "https://portal.example.com",
      prodamusPayformBaseUrl: "",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("PRODAMUS_PAYFORM_BASE_URL");
  });

  it("warns for both when both are missing", () => {
    const warnings = startupWarnings({});
    expect(warnings).toHaveLength(2);
  });

  it("treats undefined as missing", () => {
    const warnings = startupWarnings({ prodamusPayformBaseUrl: "https://pay.demo.prodamus.ru/payment" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("CLIENT_PORTAL_URL");
  });

  it("treats whitespace-only values as missing", () => {
    const warnings = startupWarnings({
      clientPortalUrl: "   ",
      prodamusPayformBaseUrl: "https://pay.demo.prodamus.ru/payment",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("CLIENT_PORTAL_URL");
  });

  it("never interpolates env values into warnings", () => {
    const portalSecret = "https://portal-secret.example.com";
    const payformSecret = "https://payform-secret.example.com";

    const warnings = startupWarnings({ clientPortalUrl: portalSecret, prodamusPayformBaseUrl: "" });
    const moreWarnings = startupWarnings({ clientPortalUrl: "", prodamusPayformBaseUrl: payformSecret });
    const all = [...warnings, ...moreWarnings];
    expect(all).toHaveLength(2);
    for (const warning of all) {
      expect(warning).not.toContain("portal-secret");
      expect(warning).not.toContain("payform-secret");
    }
  });
});