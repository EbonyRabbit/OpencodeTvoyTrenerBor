import { describe, it, expect } from "vitest";
import { startupWarnings } from "../startup-warnings.js";

describe("startupWarnings", () => {
  it("returns no warnings when both URLs are set", () => {
    const warnings = startupWarnings({
      clientPortalUrl: "https://portal.example.com",
      paymentBaseUrl: "https://portal.example.com",
    });
    expect(warnings).toEqual([]);
  });

  it("warns when CLIENT_PORTAL_URL is empty", () => {
    const warnings = startupWarnings({
      clientPortalUrl: "",
      paymentBaseUrl: "https://portal.example.com",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("CLIENT_PORTAL_URL");
    expect(warnings[0]).toContain("/myweb");
  });

  it("warns when PAYMENT_BASE_URL is empty", () => {
    const warnings = startupWarnings({
      clientPortalUrl: "https://portal.example.com",
      paymentBaseUrl: "",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("PAYMENT_BASE_URL");
  });

  it("warns for both when both are missing", () => {
    const warnings = startupWarnings({});
    expect(warnings).toHaveLength(2);
  });

  it("treats undefined as missing", () => {
    const warnings = startupWarnings({ paymentBaseUrl: "https://portal.example.com" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("CLIENT_PORTAL_URL");
  });

  it("treats whitespace-only values as missing", () => {
    const warnings = startupWarnings({
      clientPortalUrl: "   ",
      paymentBaseUrl: "https://portal.example.com",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("CLIENT_PORTAL_URL");
  });

  it("never interpolates env values into warnings", () => {
    const portalSecret = "https://portal-secret.example.com";
    const paymentSecret = "https://payment-secret.example.com";

    const warnings = startupWarnings({ clientPortalUrl: portalSecret, paymentBaseUrl: "" });
    const moreWarnings = startupWarnings({ clientPortalUrl: "", paymentBaseUrl: paymentSecret });
    const all = [...warnings, ...moreWarnings];
    expect(all).toHaveLength(2);
    for (const warning of all) {
      expect(warning).not.toContain("portal-secret");
      expect(warning).not.toContain("payment-secret");
    }
  });
});
