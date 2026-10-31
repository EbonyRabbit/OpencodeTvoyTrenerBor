import { describe, expect, it } from "vitest";

describe("auth-actions security invariant", () => {
  it(
    "does not expose public signup/self-provisioning",
    async () => {
      const mod = await import("../auth-actions");
      expect((mod as Record<string, unknown>).signup).toBeUndefined();
    },
    20_000,
  );
});
