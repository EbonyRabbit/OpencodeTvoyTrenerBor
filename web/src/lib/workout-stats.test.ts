import { describe, it, expect } from "vitest";
import { resolveWorkoutCount } from "./workout-stats";

describe("resolveWorkoutCount", () => {
  it("returns the count from a successful RPC response", () => {
    expect(resolveWorkoutCount({ data: 2, error: null })).toBe(2);
  });

  it("returns 0 when the RPC succeeds without a value", () => {
    expect(resolveWorkoutCount({ data: null, error: null })).toBe(0);
  });

  it("returns null when the RPC fails", () => {
    expect(resolveWorkoutCount({ data: null, error: new Error("failed") })).toBeNull();
  });
});
