import { describe, it, expect } from "vitest";
import {
  getParsedContent,
  isCompositeExercise,
  flattenLoggableExercises,
  type ParsedExercise,
  type ProgramRow,
} from "./program-utils";

function withContent(content: unknown): ProgramRow {
  return { parsed_content: content } as unknown as ProgramRow;
}

describe("flattenLoggableExercises", () => {
  it("returns empty array for empty input", () => {
    expect(flattenLoggableExercises([])).toEqual([]);
  });

  it("keeps plain strength exercises as-is", () => {
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

  it("keeps circuit as a single unit", () => {
    const circuit: ParsedExercise = {
      name: "AMRAP 20 мин",
      type: "circuit",
      duration: "20 мин",
      children: [{ name: "Присед" }, { name: "Берпи" }],
    };
    expect(flattenLoggableExercises([circuit])).toEqual([circuit]);
  });

  it("keeps cardio as a single unit", () => {
    const cardio: ParsedExercise = { name: "Бег 5 км", type: "cardio", distance: "5 км" };
    expect(flattenLoggableExercises([cardio])).toEqual([cardio]);
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
                  rest: "90 сек",
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
    expect(getParsedContent(withContent(input))).toEqual(input);
  });

  it("accepts a valid circuit (AMRAP) with cardio children", () => {
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
    expect(getParsedContent(withContent(input))).toEqual(input);
  });

  it("accepts a valid cardio exercise", () => {
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
                  name: "Бег интервальный",
                  type: "cardio",
                  distance: "5 км",
                  duration: "30 мин",
                  pace: "5:30/км",
                  heart_rate: "140-155",
                },
              ],
            },
          ],
        },
      ],
    };
    expect(getParsedContent(withContent(input))).toEqual(input);
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
    expect(getParsedContent(withContent(input))).toBeNull();
  });

  it("rejects non-array children", () => {
    const input = {
      weeks: [
        {
          week_number: 1,
          days: [
            {
              day_name: "День 1",
              day_order: 1,
              exercises: [{ name: "Суперсет", type: "superset", children: "no" }],
            },
          ],
        },
      ],
    };
    expect(getParsedContent(withContent(input))).toBeNull();
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
    expect(getParsedContent(withContent(input))).toBeNull();
  });

  it("rejects non-string cardio field", () => {
    const input = {
      weeks: [
        {
          week_number: 1,
          days: [
            {
              day_name: "День 1",
              day_order: 1,
              exercises: [{ name: "Бег", type: "cardio", pace: 5.5 }],
            },
          ],
        },
      ],
    };
    expect(getParsedContent(withContent(input))).toBeNull();
  });
});
