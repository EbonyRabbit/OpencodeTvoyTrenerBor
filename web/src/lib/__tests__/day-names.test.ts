import { describe, it, expect } from "vitest";
import { weekdayIsoFromName } from "../day-names";

describe("weekdayIsoFromName", () => {
  it("matches exact weekday names", () => {
    expect(weekdayIsoFromName("Понедельник")).toBe(1);
    expect(weekdayIsoFromName("воскресенье")).toBe(7);
  });

  it("matches generator-style compound names", () => {
    expect(weekdayIsoFromName("Понедельник | Грудь")).toBe(1);
    expect(weekdayIsoFromName("Среда | Спина")).toBe(3);
    expect(weekdayIsoFromName("Понедельник 12.08 | Бег")).toBe(1);
  });

  it("returns 0 for unrecognized names", () => {
    expect(weekdayIsoFromName("День 1: Жимовые")).toBe(0);
    expect(weekdayIsoFromName("Бег 1 — Интервалы")).toBe(0);
    expect(weekdayIsoFromName("")).toBe(0);
    expect(weekdayIsoFromName(null as unknown as string)).toBe(0);
  });
});