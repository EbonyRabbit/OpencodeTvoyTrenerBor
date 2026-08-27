import { describe, it, expect } from "vitest";

describe("auth-actions signup removal", () => {
  it("does not export a signup function (closes public self-provisioning of coach role)", async () => {
    const mod = await import("../auth-actions");
    expect((mod as Record<string, unknown>).signup).toBeUndefined();
  });

  it("does not allow any exported function to self-assign the coach role via signUp", async () => {
    const source = (await import("../auth-actions")) as unknown as Record<string, unknown>;
    const exportedKeys = Object.keys(source).filter(
      (k) => typeof source[k] === "function",
    );
    expect(exportedKeys).not.toContain("signup");
  });
});
