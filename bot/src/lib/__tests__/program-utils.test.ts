import { describe, it, expect } from "vitest";
import {
  getParsedContent,
  buildSpreadsheetUrl,
  getTotalWeeks,
  getCurrentWeek,
  getWorkoutDaysCount,
} from "../program-utils.js";

describe("getParsedContent", () => {
  it("returns null for null input", () => {
    expect(getParsedContent(null)).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(getParsedContent("string")).toBeNull();
    expect(getParsedContent(42)).toBeNull();
    expect(getParsedContent(true)).toBeNull();
  });

  it("returns valid parsed content", () => {
    const input = { version: 1, program_name: "Test", weeks: [] };
    expect(getParsedContent(input)).toEqual(input);
  });

  it("accepts content with only weeks", () => {
    const input = { weeks: [{ week_number: 1, days: [] }] };
    expect(getParsedContent(input)).toEqual(input);
  });

  it("rejects invalid version type", () => {
    expect(getParsedContent({ version: "1" })).toBeNull();
  });

  it("rejects invalid weeks type", () => {
    expect(getParsedContent({ weeks: "not array" })).toBeNull();
  });

  it("rejects invalid columns type", () => {
    expect(getParsedContent({ columns: [1, 2, 3] })).toBeNull();
  });
});

describe("buildSpreadsheetUrl", () => {
  it("returns null for null input", () => {
    expect(buildSpreadsheetUrl(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(buildSpreadsheetUrl("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(buildSpreadsheetUrl("  ")).toBeNull();
  });

  it("builds URL from valid ID", () => {
    const result = buildSpreadsheetUrl("abc123");
    expect(result).toBe("https://docs.google.com/spreadsheets/d/abc123/edit");
  });

  it("trims whitespace from ID", () => {
    const result = buildSpreadsheetUrl("  abc123  ");
    expect(result).toBe("https://docs.google.com/spreadsheets/d/abc123/edit");
  });
});

describe("getTotalWeeks", () => {
  it("returns 0 for null input", () => {
    expect(getTotalWeeks(null)).toBe(0);
  });

  it("returns 0 for content without weeks", () => {
    expect(getTotalWeeks({})).toBe(0);
  });

  it("returns week count", () => {
    const parsed = {
      weeks: [
        { week_number: 1 },
        { week_number: 2 },
        { week_number: 3 },
      ],
    };
    expect(getTotalWeeks(parsed)).toBe(3);
  });
});

describe("getCurrentWeek", () => {
  const schedule = [
    { week_number: 1, start_date: "2026-07-01", end_date: "2026-07-07" },
    { week_number: 2, start_date: "2026-07-08", end_date: "2026-07-14" },
    { week_number: 3, start_date: "2026-07-15", end_date: "2026-07-21" },
  ];

  it("returns week number for date in range", () => {
    expect(getCurrentWeek(schedule, "2026-07-01")).toBe(1);
    expect(getCurrentWeek(schedule, "2026-07-07")).toBe(1);
    expect(getCurrentWeek(schedule, "2026-07-10")).toBe(2);
  });

  it("returns null for date outside all ranges", () => {
    expect(getCurrentWeek(schedule, "2026-06-30")).toBeNull();
    expect(getCurrentWeek(schedule, "2026-07-22")).toBeNull();
  });

  it("skips weeks with null dates", () => {
    const mixed = [
      { week_number: 1, start_date: null, end_date: null },
      { week_number: 2, start_date: "2026-07-08", end_date: "2026-07-14" },
    ];
    expect(getCurrentWeek(mixed, "2026-07-10")).toBe(2);
  });
});

describe("getWorkoutDaysCount", () => {
  it("returns 0 for null input", () => {
    expect(getWorkoutDaysCount(null, 1)).toBe(0);
  });

  it("returns 0 for missing week", () => {
    const parsed = { weeks: [{ week_number: 1, days: [] }] };
    expect(getWorkoutDaysCount(parsed, 2)).toBe(0);
  });

  it("counts days with exercises", () => {
    const parsed = {
      weeks: [
        {
          week_number: 1,
          days: [
            { day_name: "Day 1", day_order: 1, exercises: [{ name: "Ex1" }] },
            { day_name: "Day 2", day_order: 2, exercises: [] },
            { day_name: "Day 3", day_order: 3, exercises: [{ name: "Ex2" }, { name: "Ex3" }] },
          ],
        },
      ],
    };
    expect(getWorkoutDaysCount(parsed, 1)).toBe(2);
  });

  it("returns 0 for week with no days", () => {
    const parsed = { weeks: [{ week_number: 1 }] };
    expect(getWorkoutDaysCount(parsed, 1)).toBe(0);
  });
});
