import { describe, it, expect } from "vitest";
import {
  getEffectiveTrainingDays,
  availablePostponeDays,
  replaceTrainingDay,
  dayAvailability,
} from "../postpone-utils.js";

describe("getEffectiveTrainingDays", () => {
  it("uses the week override when present", () => {
    const client = { training_days: [1, 3, 5] } as never;
    expect(getEffectiveTrainingDays(client, { training_days: [2, 4] })).toEqual([2, 4]);
  });

  it("falls back to client training days when week has none", () => {
    const client = { training_days: [1, 3, 5] } as never;
    expect(getEffectiveTrainingDays(client, { training_days: null })).toEqual([1, 3, 5]);
  });

  it("returns client days when no week row", () => {
    const client = { training_days: [1, 3, 5] } as never;
    expect(getEffectiveTrainingDays(client, null)).toEqual([1, 3, 5]);
  });

  it("returns null when neither has days", () => {
    const client = { training_days: null } as never;
    expect(getEffectiveTrainingDays(client, { training_days: null })).toBeNull();
  });
});

describe("availablePostponeDays", () => {
  it("lists days after today up to end of week", () => {
    // 2026-08-03 = Monday
    expect(availablePostponeDays("2026-08-03", "2026-08-09")).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("returns nothing on Sunday", () => {
    expect(availablePostponeDays("2026-08-09", "2026-08-09")).toEqual([]);
  });

  it("stops at the week end date", () => {
    // 2026-08-04 = Tuesday; end Friday 2026-08-07
    expect(availablePostponeDays("2026-08-04", "2026-08-07")).toEqual([3, 4, 5]);
  });

  it("does not list days before today", () => {
    // 2026-08-05 = Wednesday
    expect(availablePostponeDays("2026-08-05", "2026-08-09")).toEqual([4, 5, 6, 7]);
  });

  it("works for weeks starting mid-week", () => {
    // week Wed 2026-08-05 .. Tue 2026-08-11; today = Sat 2026-08-08
    expect(availablePostponeDays("2026-08-08", "2026-08-11")).toEqual([7, 1, 2]);
  });

  it("falls back to the end of the current ISO week when endDate is null", () => {
    // Monday 2026-08-03, no endDate -> up to Sunday
    expect(availablePostponeDays("2026-08-03", null)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("returns nothing when the week end date is in the past", () => {
    expect(availablePostponeDays("2026-08-05", "2026-08-04")).toEqual([]);
  });

  it("returns nothing for an invalid today string", () => {
    expect(availablePostponeDays("not-a-date", "2026-08-09")).toEqual([]);
  });

  it("collects each weekday once across a week boundary", () => {
    // Mon 2026-08-03 .. 2026-08-17: weekdays repeat after Sunday
    expect(availablePostponeDays("2026-08-03", "2026-08-17")).toEqual([2, 3, 4, 5, 6, 7, 1]);
  });
});

describe("replaceTrainingDay", () => {
  it("moves a day keeping its position", () => {
    expect(replaceTrainingDay([1, 3, 5], 1, 2)).toEqual([2, 3, 5]);
  });

  it("does not duplicate when the target day already exists", () => {
    expect(replaceTrainingDay([1, 3, 5], 1, 3)).toEqual([3, 5]);
  });

  it("removes the source day entirely", () => {
    expect(replaceTrainingDay([1, 3, 5], 5, 6)).toEqual([1, 3, 6]);
  });

  it("keeps the moved day position so its content follows it", () => {
    // Wed (D2) -> Sat: Saturday must keep the day-2 content slot
    expect(replaceTrainingDay([1, 3, 5], 3, 6)).toEqual([1, 6, 5]);
  });

  it("no-ops when the source day is absent", () => {
    expect(replaceTrainingDay([1, 3, 5], 2, 6)).toEqual([1, 3, 5]);
  });
});

describe("dayAvailability", () => {
  it("allows a free day within the week", () => {
    expect(dayAvailability(2, [2, 3, 4], [1, 5])).toEqual({ ok: true });
  });

  it("rejects an occupied day", () => {
    expect(dayAvailability(3, [2, 3, 4], [1, 3])).toEqual({ ok: false, reason: "occupied" });
  });

  it("rejects a day outside the available range", () => {
    expect(dayAvailability(6, [2, 3], [1])).toEqual({ ok: false, reason: "not_in_week" });
  });
});
