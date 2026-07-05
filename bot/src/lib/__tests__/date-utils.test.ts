import { describe, it, expect } from "vitest";
import { daysBetween, addDays, sleep } from "../date-utils.js";

describe("daysBetween", () => {
  it("calculates difference between two dates", () => {
    expect(daysBetween("2026-07-01", "2026-07-02")).toBe(1);
    expect(daysBetween("2026-07-01", "2026-07-08")).toBe(7);
  });

  it("returns 0 for same date", () => {
    expect(daysBetween("2026-07-01", "2026-07-01")).toBe(0);
  });

  it("returns negative for reverse order", () => {
    expect(daysBetween("2026-07-02", "2026-07-01")).toBe(-1);
  });

  it("handles month boundaries", () => {
    expect(daysBetween("2026-06-30", "2026-07-01")).toBe(1);
  });

  it("handles leap years", () => {
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2);
  });

  it("handles large gaps", () => {
    expect(daysBetween("2026-01-01", "2026-12-31")).toBe(364);
  });
});

describe("addDays", () => {
  it("adds days to a date", () => {
    expect(addDays("2026-07-01", 1)).toBe("2026-07-02");
    expect(addDays("2026-07-01", 7)).toBe("2026-07-08");
  });

  it("subtracts days with negative input", () => {
    expect(addDays("2026-07-02", -1)).toBe("2026-07-01");
  });

  it("handles month boundaries", () => {
    expect(addDays("2026-06-30", 1)).toBe("2026-07-01");
  });

  it("handles adding 0 days", () => {
    expect(addDays("2026-07-01", 0)).toBe("2026-07-01");
  });

  it("handles year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("sleep", () => {
  it("resolves after specified time", async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});
