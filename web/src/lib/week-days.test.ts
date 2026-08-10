import { describe, it, expect } from "vitest";
import { weekdayDateInWeek } from "./week-days";

describe("weekdayDateInWeek", () => {
  it("finds the weekday date in a Monday-anchored week", () => {
    expect(weekdayDateInWeek("2026-08-03", "2026-08-09", 6)).toBe("2026-08-08");
  });

  it("finds the weekday date in a mid-week-anchored week", () => {
    // Week starts Wednesday 2026-08-05; Saturday of that window is 2026-08-08
    expect(weekdayDateInWeek("2026-08-05", "2026-08-11", 6)).toBe("2026-08-08");
    expect(weekdayDateInWeek("2026-08-05", "2026-08-11", 1)).toBe("2026-08-10");
  });

  it("returns null when the weekday is not inside the window", () => {
    // Wed..Sun window contains no Monday
    expect(weekdayDateInWeek("2026-08-05", "2026-08-09", 1)).toBeNull();
  });

  it("rejects an out-of-range weekday", () => {
    expect(weekdayDateInWeek("2026-08-05", "2026-08-11", 8)).toBeNull();
    expect(weekdayDateInWeek("2026-08-05", "2026-08-11", 0)).toBeNull();
  });

  it("returns null when the window end is before its start", () => {
    expect(weekdayDateInWeek("2026-08-05", "2026-08-04", 3)).toBeNull();
  });

  it("returns null for an invalid start date", () => {
    expect(weekdayDateInWeek("not-a-date", "2026-08-11", 3)).toBeNull();
  });

  it("falls back to a 7-day window when endDate is null", () => {
    // Wed 2026-08-05 + 6 days = Tue 2026-08-11; Monday of that window:
    expect(weekdayDateInWeek("2026-08-05", null, 1)).toBe("2026-08-10");
  });
});
