import { describe, it, expect } from "vitest";
import {
  getParsedContent,
  buildSpreadsheetUrl,
  getTotalWeeks,
  getCurrentWeek,
  getWorkoutDaysCount,
  isCompositeExercise,
  flattenLoggableExercises,
  type ParsedExercise,
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

describe("flattenLoggableExercises", () => {
  it("returns empty array for empty input", () => {
    expect(flattenLoggableExercises([])).toEqual([]);
  });

  it("keeps plain exercises as-is", () => {
    const exercises: ParsedExercise[] = [{ name: "Жим" }, { name: "Присед" }];
    expect(flattenLoggableExercises(exercises)).toEqual(exercises);
  });

  it("expands superset into its children", () => {
    const superset: ParsedExercise = {
      name: "Суперсет A",
      type: "superset",
      sets: "3",
      children: [{ name: "Жим лёжа" }, { name: "Тяга в наклоне" }],
    };
    const result = flattenLoggableExercises([superset, { name: "Берпи" }]);
    expect(result.map((e) => e.name)).toEqual(["Жим лёжа", "Тяга в наклоне", "Берпи"]);
  });

  it("keeps superset itself if it has no children", () => {
    const superset: ParsedExercise = { name: "Суперсет A", type: "superset" };
    expect(flattenLoggableExercises([superset])).toEqual([superset]);
  });

  it("keeps circuit and cardio as single units", () => {
    const circuit: ParsedExercise = {
      name: "AMRAP 20 мин",
      type: "circuit",
      children: [{ name: "Присед" }],
    };
    const cardio: ParsedExercise = { name: "Бег", type: "cardio", distance: "5 км" };
    expect(flattenLoggableExercises([circuit, cardio])).toEqual([circuit, cardio]);
  });
});

describe("isCompositeExercise", () => {
  it("returns true for superset and circuit", () => {
    expect(isCompositeExercise({ name: "A", type: "superset" })).toBe(true);
    expect(isCompositeExercise({ name: "A", type: "circuit" })).toBe(true);
  });

  it("returns false for strength, cardio and default", () => {
    expect(isCompositeExercise({ name: "A", type: "strength" })).toBe(false);
    expect(isCompositeExercise({ name: "A", type: "cardio" })).toBe(false);
    expect(isCompositeExercise({ name: "A" })).toBe(false);
  });
});

describe("getParsedContent (composites)", () => {
  it("accepts a valid superset with children", () => {
    const input = {
      weeks: [
        {
          week_number: 1,
          days: [
            {
              day_name: "День 1",
              day_order: 1,
              exercises: [
                {
                  name: "Суперсет A",
                  type: "superset",
                  sets: "3",
                  children: [
                    { name: "Жим лёжа", reps: "8", weight: "60 кг", rpe: "8" },
                    { name: "Тяга в наклоне", reps: "10", weight: "40 кг", rpe: "7" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(getParsedContent(input)).toEqual(input);
  });

  it("accepts a valid circuit with cardio children", () => {
    const input = {
      weeks: [
        {
          week_number: 1,
          days: [
            {
              day_name: "День 1",
              day_order: 1,
              exercises: [
                {
                  name: "AMRAP 20 мин",
                  type: "circuit",
                  duration: "20 мин",
                  rounds: "МАКС",
                  children: [
                    { name: "Приседания", reps: "20", weight: "60 кг" },
                    { name: "Берпи", reps: "10" },
                    { name: "Бег", type: "cardio", distance: "500 м" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(getParsedContent(input)).toEqual(input);
  });

  it("rejects unknown exercise type", () => {
    const input = {
      weeks: [
        {
          week_number: 1,
          days: [
            { day_name: "День 1", day_order: 1, exercises: [{ name: "X", type: "emom" }] },
          ],
        },
      ],
    };
    expect(getParsedContent(input)).toBeNull();
  });

  it("rejects composite nested inside composite", () => {
    const input = {
      weeks: [
        {
          week_number: 1,
          days: [
            {
              day_name: "День 1",
              day_order: 1,
              exercises: [
                {
                  name: "Суперсет",
                  type: "superset",
                  children: [
                    { name: "Жим", type: "strength" },
                    { name: "Вложенный круг", type: "circuit", children: [{ name: "Берпи" }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(getParsedContent(input)).toBeNull();
  });
});
