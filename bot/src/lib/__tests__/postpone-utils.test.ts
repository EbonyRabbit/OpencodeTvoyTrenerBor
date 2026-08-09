import { describe, it, expect } from "vitest";
import {
  getEffectiveTrainingDays,
  weekdayOfDate,
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

describe("weekdayOfDate", () => {
  it("maps Sunday to 7", () => {
    expect(weekdayOfDate("2026-08-09")).toBe(7);
  });

  it("maps Monday to 1", () => {
    expect(weekdayOfDate("2026-08-03")).toBe(1);
  });

  it("treats null as Sunday (end of week)", () => {
    expect(weekdayOfDate(null)).toBe(7);
  });
});

describe("availablePostponeDays", () => {
  it("lists days after today up to end of week", () => {
    expect(availablePostponeDays(1, "2026-08-09")).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("returns nothing on Sunday", () => {
    expect(availablePostponeDays(7, "2026-08-09")).toEqual([]);
  });

  it("stops at the week end date", () => {
    expect(availablePostponeDays(4, "2026-08-07")).toEqual([5]);
  });

  it("does not list days before today", () => {
    expect(availablePostponeDays(3, "2026-08-09")).toEqual([4, 5, 6, 7]);
  });
});

describe("replaceTrainingDay", () => {
  it("moves a day keeping order", () => {
    expect(replaceTrainingDay([1, 3, 5], 1, 2)).toEqual([2, 3, 5]);
  });

  it("does not duplicate when the target day already exists", () => {
    expect(replaceTrainingDay([1, 3, 5], 1, 3)).toEqual([3, 5]);
  });

  it("removes the source day entirely", () => {
    expect(replaceTrainingDay([1, 3, 5], 5, 6)).toEqual([1, 3, 6]);
  });

  it("sorts the resulting list", () => {
    expect(replaceTrainingDay([1, 3, 5], 5, 2)).toEqual([1, 2, 3]);
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