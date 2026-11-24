import { describe, expect, it } from "vitest";
import {
  formatPeriodLabel,
  resolveHistorySelection,
  type HistoryPeriodOption,
} from "@/lib/history-periods";

const periods: HistoryPeriodOption[] = [
  {
    id: "active-period",
    programId: "new-program",
    programTitle: "Новая программа",
    startedAt: "2026-11-16T10:00:00.000Z",
    endedAt: null,
    status: "active",
  },
  {
    id: "old-period",
    programId: "old-program",
    programTitle: "Старая программа",
    startedAt: "2026-11-01T10:00:00.000Z",
    endedAt: "2026-11-15T10:00:00.000Z",
    status: "completed",
  },
];

describe("resolveHistorySelection", () => {
  it("keeps the active period by default", () => {
    expect(resolveHistorySelection(undefined, periods, "active-period")).toEqual({
      mode: "period",
      periodId: "active-period",
    });
  });

  it("selects an old period by id", () => {
    expect(resolveHistorySelection("old-period", periods, "active-period")).toEqual({
      mode: "period",
      periodId: "old-period",
    });
  });

  it("switches to the all-workouts mode", () => {
    expect(resolveHistorySelection("all", periods, "active-period")).toEqual({
      mode: "all",
      periodId: null,
    });
  });

  it("falls back to the active period for an unknown id", () => {
    expect(resolveHistorySelection("missing", periods, "active-period")).toEqual({
      mode: "period",
      periodId: "active-period",
    });
  });

  it("falls back to the newest period when there is no active one", () => {
    expect(resolveHistorySelection(undefined, periods, null)).toEqual({
      mode: "period",
      periodId: "active-period",
    });
  });

  it("accepts an array search param", () => {
    expect(resolveHistorySelection(["old-period", "other"], periods, "active-period")).toEqual({
      mode: "period",
      periodId: "old-period",
    });
  });

  it("handles an empty period list", () => {
    expect(resolveHistorySelection("all", [], null)).toEqual({
      mode: "all",
      periodId: null,
    });
    expect(resolveHistorySelection(undefined, [], null)).toEqual({
      mode: "period",
      periodId: null,
    });
  });
});

describe("formatPeriodLabel", () => {
  it("includes the program title and period state", () => {
    const label = formatPeriodLabel(periods[1]);
    expect(label).toContain("Старая программа");
    expect(label).toContain("завершён");
  });
});
