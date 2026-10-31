import { describe, expect, it } from "vitest";
import {
  calculateE1rm,
  daysBetweenIso,
  isAssistedExercise,
  parseRepsToSets,
  parseTargetReps,
  roundToStep,
  suggestTarget,
  weightStepFor,
} from "../training-progress.js";

const log = (overrides: Record<string, unknown> = {}) => ({
  weight: 100,
  sets: 3,
  reps: "10/10/10",
  date: "2026-10-01",
  ...overrides,
});

describe("parseRepsToSets", () => {
  it("parses slash-separated sets", () => {
    expect(parseRepsToSets("10/10/8")).toEqual([10, 10, 8]);
  });

  it("parses a single repetition value", () => {
    expect(parseRepsToSets("10")).toEqual([10]);
  });

  it("returns null for a range", () => {
    expect(parseRepsToSets("8-10")).toBeNull();
  });

  it("returns null for malformed values", () => {
    expect(parseRepsToSets("10/x")).toBeNull();
    expect(parseRepsToSets("0/10")).toBeNull();
    expect(parseRepsToSets("")).toBeNull();
  });
});

describe("parseTargetReps", () => {
  it("parses ranges with different dashes", () => {
    expect(parseTargetReps("8-10")).toEqual({ min: 8, max: 10 });
    expect(parseTargetReps("8 – 10")).toEqual({ min: 8, max: 10 });
    expect(parseTargetReps("10—8")).toEqual({ min: 8, max: 10 });
  });

  it("parses a single target", () => {
    expect(parseTargetReps("12")).toEqual({ min: 12, max: 12 });
  });

  it("rejects non-plan formats", () => {
    expect(parseTargetReps("10/10/8")).toBeNull();
    expect(parseTargetReps(null)).toBeNull();
  });
});

describe("weightStepFor", () => {
  it.each([
    ["Штанга", 2.5],
    ["Гантели, скамья", 2],
    ["Гиря", 4],
    ["Тренажёр", 5],
    ["Блок/резинка", 5],
    ["Смит", 5],
    ["Без инвентаря", 0],
    ["Турник", 0],
    ["Брусья", 0],
    ["Резинка", 0],
    [null, 0],
    ["Неизвестно", 0],
  ])("maps %s to %s", (equipment, step) => {
    expect(weightStepFor(equipment as string | null)).toBe(step);
  });
});

describe("calculateE1rm", () => {
  it("uses the Epley formula and caps reps at 10", () => {
    expect(calculateE1rm(100, 10)).toBe(133.3);
    expect(calculateE1rm(100, 12)).toBe(133.3);
    expect(calculateE1rm(80, 5)).toBe(93.3);
  });

  it("returns zero for bodyweight or invalid input", () => {
    expect(calculateE1rm(0, 5)).toBe(0);
    expect(calculateE1rm(100, 0)).toBe(0);
  });
});

describe("roundToStep", () => {
  it("rounds to the nearest available step", () => {
    expect(roundToStep(66, 2.5)).toBe(65);
    expect(roundToStep(67, 2.5)).toBe(67.5);
    expect(roundToStep(57.75, 2.5)).toBe(57.5);
  });

  it("falls back to one decimal without a step", () => {
    expect(roundToStep(57.75, 0)).toBe(57.8);
  });
});

describe("daysBetweenIso", () => {
  it("counts days across months", () => {
    expect(daysBetweenIso("2026-09-30", "2026-10-12")).toBe(12);
  });

  it("returns null for invalid dates", () => {
    expect(daysBetweenIso("not-a-date", "2026-10-12")).toBeNull();
  });
});

describe("isAssistedExercise", () => {
  it("detects gravitron by name and equipment", () => {
    expect(isAssistedExercise("Подтягивания в гравитроне")).toBe(true);
    expect(isAssistedExercise("Подтягивания", "Гравитрон")).toBe(true);
    expect(isAssistedExercise("Подтягивания")).toBe(false);
  });
});

describe("suggestTarget", () => {
  it("uses the plan when there is no history", () => {
    expect(suggestTarget({ plannedWeight: "80", plannedSets: "3", plannedReps: "8-10", lastLog: null }))
      .toEqual({ weightKg: 80, repsMin: 8, repsMax: 10, source: "plan" });
  });

  it("returns no target without history or planned weight", () => {
    expect(suggestTarget({ plannedWeight: null, plannedReps: "8-10", lastLog: null })).toBeNull();
  });

  it("ignores the original plan weight for a swapped exercise without its own history", () => {
    expect(suggestTarget({
      plannedWeight: "80", plannedSets: "3", plannedReps: "8-10",
      lastLog: null, isSwapped: true,
    })).toBeNull();
  });

  it("accepts a plain kg plan weight", () => {
    expect(suggestTarget({ plannedWeight: "80 кг", plannedReps: "8-10", lastLog: null }))
      .toMatchObject({ weightKg: 80 });
  });

  it.each(["70%", "рабочий +2.5%", "тумба 60 см", "+5 кг"])(
    "does not treat a descriptive plan weight as kilograms: %s",
    (plannedWeight) => {
      expect(suggestTarget({ plannedWeight, plannedReps: "8-10", lastLog: null })).toBeNull();
    },
  );

  it("returns a reps-only target for planned bodyweight work", () => {
    expect(suggestTarget({ plannedWeight: "0", plannedReps: "8-10", lastLog: null }))
      .toEqual({ weightKg: null, repsMin: 8, repsMax: 10, source: "plan" });
  });

  it("increases weight after all sets hit the top of the range", () => {
    expect(suggestTarget({
      exerciseName: "Приседания со штангой",
      plannedWeight: "100", plannedSets: "3", plannedReps: "8-10",
      lastLog: log(), equipment: "Штанга", today: "2026-10-08",
    })).toMatchObject({ weightKg: 102.5, repsMin: 8, repsMax: 10 });
  });

  it("keeps weight when one set missed the top", () => {
    expect(suggestTarget({
      exerciseName: "Приседания со штангой",
      plannedWeight: "100", plannedSets: "3", plannedReps: "8-10",
      lastLog: log({ reps: "10/10/8" }), equipment: "Штанга", today: "2026-10-08",
    })).toMatchObject({ weightKg: 100, repsMin: 9, repsMax: 10 });
  });

  it("keeps weight and asks for the planned reps after fewer sets", () => {
    expect(suggestTarget({
      exerciseName: "Приседания со штангой",
      plannedWeight: "100", plannedSets: "4", plannedReps: "8-10",
      lastLog: log({ sets: 3 }), equipment: "Штанга", today: "2026-10-08",
    })).toMatchObject({ weightKg: 100, repsMin: 8, repsMax: 10 });
  });

  it("uses the logged set count for a single-value rep entry", () => {
    expect(suggestTarget({
      exerciseName: "Приседания со штангой",
      plannedWeight: "100", plannedSets: "3", plannedReps: "8",
      lastLog: log({ sets: 4, reps: "8" }), equipment: "Штанга", today: "2026-10-08",
    })).toMatchObject({ weightKg: 102.5, repsMin: 8, repsMax: 8 });
  });

  it("uses the logged set count for three sets of ten", () => {
    expect(suggestTarget({
      exerciseName: "Жим лёжа",
      plannedWeight: "80", plannedSets: "3", plannedReps: "10",
      lastLog: log({ weight: 80, sets: 3, reps: "10" }), equipment: "Штанга", today: "2026-10-08",
    })).toMatchObject({ weightKg: 82.5, repsMin: 10, repsMax: 10 });
  });

  it("does not increase weight for a rep range entry", () => {
    expect(suggestTarget({
      exerciseName: "Приседания со штангой",
      plannedWeight: "100", plannedSets: "3", plannedReps: "8-10",
      lastLog: log({ reps: "8-10" }), equipment: "Штанга", today: "2026-10-08",
    })).toMatchObject({ weightKg: 100, repsMin: 8 });
  });

  it("uses 80 percent and the lower rep bound on a deload", () => {
    expect(suggestTarget({
      exerciseName: "Приседания со штангой",
      plannedWeight: "100", plannedSets: "3", plannedReps: "8-10",
      lastLog: log(), equipment: "Штанга", isDeload: true, today: "2026-10-08",
    })).toMatchObject({ weightKg: 80, repsMin: 8, repsMax: 8 });
  });

  it("uses 80 percent and the lower rep bound after 11-21 days", () => {
    expect(suggestTarget({
      exerciseName: "Приседания со штангой",
      plannedWeight: "100", plannedSets: "3", plannedReps: "8-10",
      lastLog: log(), equipment: "Штанга", today: "2026-10-20",
    })).toMatchObject({ weightKg: 80, repsMin: 8, repsMax: 8 });
  });

  it("uses 70 percent and the lower rep bound after more than 21 days", () => {
    expect(suggestTarget({
      exerciseName: "Приседания со штангой",
      plannedWeight: "100", plannedSets: "3", plannedReps: "8-10",
      lastLog: log(), equipment: "Штанга", today: "2026-10-23",
    })).toMatchObject({ weightKg: 70, repsMin: 8, repsMax: 8 });
  });

  it("keeps weight when equipment step is unknown", () => {
    expect(suggestTarget({
      exerciseName: "Приседания",
      plannedWeight: "100", plannedSets: "3", plannedReps: "8-10",
      lastLog: log(), equipment: "Неизвестный снаряд", today: "2026-10-08",
    })).toMatchObject({ weightKg: 100, repsMin: 8 });
  });

  it("does not increase bodyweight exercises", () => {
    expect(suggestTarget({
      exerciseName: "Подтягивания",
      plannedWeight: "0", plannedSets: "3", plannedReps: "8-10",
      lastLog: log({ weight: 0 }), equipment: "Турник", today: "2026-10-08",
    })).toMatchObject({ weightKg: null, repsMin: 8, repsMax: 10 });
  });

  it("reduces gravitron assistance by five kilos", () => {
    const target = suggestTarget({
      exerciseName: "Подтягивания в гравитроне",
      plannedWeight: "20", plannedSets: "3", plannedReps: "8-10",
      lastLog: log({ weight: 20 }), equipment: "Тренажёр", today: "2026-10-08",
    });
    expect(target?.weightKg).toBe(15);
  });

  it("falls back to a five-kilo assisted step without equipment data", () => {
    const target = suggestTarget({
      exerciseName: "Подтягивания в гравитроне",
      plannedWeight: "20", plannedSets: "3", plannedReps: "8-10",
      lastLog: log({ weight: 20 }), equipment: null, today: "2026-10-08",
    });
    expect(target?.weightKg).toBe(15);
  });

  it("makes a gravitron deload easier by increasing assistance", () => {
    const target = suggestTarget({
      exerciseName: "Подтягивания в гравитроне",
      plannedWeight: "20", plannedSets: "3", plannedReps: "8-10",
      lastLog: log({ weight: 20 }), equipment: "Тренажёр",
      isDeload: true, today: "2026-10-08",
    });
    expect(target?.weightKg).toBe(25);
    expect(target?.repsMax).toBe(8);
  });

  it("keeps a deload below the previous weight even after rounding", () => {
    expect(suggestTarget({
      exerciseName: "Приседания со штангой",
      plannedWeight: "5", plannedSets: "3", plannedReps: "8-10",
      lastLog: log({ weight: 5 }), equipment: "Штанга",
      isDeload: true, today: "2026-10-08",
    })?.weightKg).toBe(2.5);
  });

  it("never drops assisted weight below zero", () => {
    const target = suggestTarget({
      exerciseName: "Подтягивания в гравитроне",
      plannedWeight: "5", plannedSets: "3", plannedReps: "8-10",
      lastLog: log({ weight: 3 }), equipment: "Тренажёр", today: "2026-10-08",
    });
    expect(target?.weightKg).toBeNull();
  });
});
