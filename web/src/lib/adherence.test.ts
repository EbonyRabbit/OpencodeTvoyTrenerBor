import { describe, it, expect } from "vitest";
import { calculateAdherence, type WorkoutLog } from "./adherence";
import type { ParsedContent } from "./program-utils";

const MON_WED_FRI_WEEK: ParsedContent = {
  weeks: [
    {
      week_number: 1,
      days: [
        {
          day_order: 1,
          day_name: "Понедельник",
          exercises: [{ name: "Присед" }, { name: "Жим лёжа" }],
        },
        {
          day_order: 2,
          day_name: "Среда",
          exercises: [{ name: "Тяга" }],
        },
        {
          day_order: 3,
          day_name: "Пятница",
          exercises: [{ name: "Становая" }],
        },
      ],
    },
    {
      week_number: 2,
      days: [
        {
          day_order: 1,
          day_name: "Понедельник",
          exercises: [{ name: "Присед" }, { name: "Жим лёжа" }],
        },
        {
          day_order: 2,
          day_name: "Среда",
          exercises: [{ name: "Тяга" }],
        },
        {
          day_order: 3,
          day_name: "Пятница",
          exercises: [{ name: "Становая" }],
        },
      ],
    },
  ],
};

const SCHEDULE = [
  { week_number: 1, start_date: "2026-08-03", end_date: "2026-08-09", focus: null },
  { week_number: 2, start_date: "2026-08-10", end_date: "2026-08-16", focus: null },
];

// 2026-08-03 = Monday (iso 1), 2026-08-05 = Wednesday (iso 3), 2026-08-07 = Friday (iso 5)
const TRAINING_DAYS = [1, 3, 5];

function log(date: string, exercise: string, extra: Partial<WorkoutLog> = {}): WorkoutLog {
  return { date, exercise, week: null, day_order: null, ...extra };
}

describe("calculateAdherence (date path)", () => {
  it("counts a fully logged workout as completed", () => {
    const result = calculateAdherence(
      SCHEDULE,
      MON_WED_FRI_WEEK,
      [log("2026-08-03", "Присед"), log("2026-08-03", "жим лёжа")],
      TRAINING_DAYS,
      "2026-08-16",
    );
    expect(result.weeks[0].completed).toBe(1);
    expect(result.weeks[0].expected).toBe(3);
  });

  it("does not count a partial workout as completed", () => {
    const result = calculateAdherence(
      SCHEDULE,
      MON_WED_FRI_WEEK,
      [log("2026-08-03", "Присед")],
      TRAINING_DAYS,
      "2026-08-16",
    );
    expect(result.weeks[0].completed).toBe(0);
    expect(result.weeks[0].expected).toBe(3);
  });

  it("does not count a skipped day as completed", () => {
    const result = calculateAdherence(
      SCHEDULE,
      MON_WED_FRI_WEEK,
      [log("2026-08-03", "[SKIP]")],
      TRAINING_DAYS,
      "2026-08-16",
    );
    expect(result.weeks[0].completed).toBe(0);
  });

  it("ignores pseudo rows (evening photos) and rest days", () => {
    const result = calculateAdherence(
      SCHEDULE,
      MON_WED_FRI_WEEK,
      [log("2026-08-04", "[EVENING_ФОТО]"), log("2026-08-04", "Присед")],
      TRAINING_DAYS,
      "2026-08-16",
    );
    expect(result.weeks[0].expected).toBe(3);
    expect(result.weeks[0].completed).toBe(0);
  });

  it("does not count future planned days of the current week", () => {
    // today = Wednesday: Monday and Wednesday are due, Friday is not
    const result = calculateAdherence(
      SCHEDULE,
      MON_WED_FRI_WEEK,
      [log("2026-08-03", "Присед"), log("2026-08-03", "Жим лёжа")],
      TRAINING_DAYS,
      "2026-08-05",
    );
    expect(result.weeks[0].expected).toBe(2);
    expect(result.weeks[0].completed).toBe(1);
  });

  it("matches names case-insensitively and after trimming", () => {
    const result = calculateAdherence(
      SCHEDULE,
      MON_WED_FRI_WEEK,
      [log("2026-08-03", "  присед "), log("2026-08-03", "ЖИМ ЛЁЖА")],
      TRAINING_DAYS,
      "2026-08-16",
    );
    expect(result.weeks[0].completed).toBe(1);
  });

  it("skips weeks with null dates and past weeks only", () => {
    const result = calculateAdherence(
      [{ week_number: 1, start_date: null, end_date: null, focus: null }],
      MON_WED_FRI_WEEK,
      [],
      TRAINING_DAYS,
      "2026-08-16",
    );
    expect(result.weeks.length).toBe(0);
    expect(result.overallAdherence).toBeNull();
  });

  it("excludes a whole future week (start_date after today)", () => {
    const result = calculateAdherence(
      SCHEDULE,
      MON_WED_FRI_WEEK,
      [log("2026-08-03", "Присед"), log("2026-08-03", "Жим лёжа")],
      TRAINING_DAYS,
      "2026-08-04",
    );
    expect(result.weeks.length).toBe(1);
    expect(result.weeks[0].weekNumber).toBe(1);
  });
});

describe("calculateAdherence (day_order fallback, no training_days)", () => {
  it("counts by stored day_order", () => {
    const result = calculateAdherence(
      SCHEDULE,
      MON_WED_FRI_WEEK,
      [
        log("2026-08-03", "Присед", { week: 1, day_order: 1 }),
        log("2026-08-03", "Жим лёжа", { week: 1, day_order: 1 }),
      ],
      null,
      "2026-08-16",
    );
    expect(result.weeks[0].completed).toBe(1);
  });

  it("does not count a partial day in fallback path", () => {
    const result = calculateAdherence(
      SCHEDULE,
      MON_WED_FRI_WEEK,
      [log("2026-08-03", "Присед", { week: 1, day_order: 1 })],
      null,
      "2026-08-16",
    );
    expect(result.weeks[0].completed).toBe(0);
  });

  it("excludes future planned days of the current week via day_name", () => {
    // today = Wednesday of week 1; Friday (day_order 3) is not due yet
    const result = calculateAdherence(
      SCHEDULE,
      MON_WED_FRI_WEEK,
      [],
      null,
      "2026-08-05",
    );
    expect(result.weeks[0].expected).toBe(2);
  });

  it("counts legacy logs with null day_order via the planned date", () => {
    // no training_days, no day_order stored (legacy data): day matched by
    // the planned date derived from the day name
    const result = calculateAdherence(
      SCHEDULE,
      MON_WED_FRI_WEEK,
      [
        log("2026-08-03", "Присед", { week: 1 }),
        log("2026-08-03", "жим лёжа", { week: 1 }),
        log("2026-08-05", "Тяга", { week: 1 }),
      ],
      null,
      "2026-08-16",
    );
    expect(result.weeks[0].completed).toBe(2);
    expect(result.weeks[0].expected).toBe(3);
  });

  it("does not double-count the same planned day from order and date matches", () => {
    // day_order=1 logs logged on Wednesday + legacy logs on the planned
    // Monday date: still exactly one completed day
    const result = calculateAdherence(
      SCHEDULE,
      MON_WED_FRI_WEEK,
      [
        log("2026-08-05", "Присед", { week: 1, day_order: 1 }),
        log("2026-08-05", "Жим лёжа", { week: 1, day_order: 1 }),
        log("2026-08-03", "Присед", { week: 1 }),
        log("2026-08-03", "Жим лёжа", { week: 1 }),
      ],
      null,
      "2026-08-16",
    );
    expect(result.weeks[0].completed).toBe(1);
    expect(result.totalCompleted).toBe(1);
  });

  it("counts an order-mismatched log on the planned date for its own day only", () => {
    // Monday's exercise logged on Monday but tagged with day_order=2 must
    // not complete Monday by date (cross-contamination guard)
    const result = calculateAdherence(
      SCHEDULE,
      MON_WED_FRI_WEEK,
      [
        log("2026-08-03", "Присед", { week: 1, day_order: 2 }),
        log("2026-08-03", "Жим лёжа", { week: 1, day_order: 2 }),
      ],
      null,
      "2026-08-16",
    );
    expect(result.weeks[0].completed).toBe(0);
  });

  it("counts full coverage across weeks with stored day_order", () => {
    const result = calculateAdherence(
      SCHEDULE,
      MON_WED_FRI_WEEK,
      [
        log("2026-08-03", "Присед", { week: 1, day_order: 1 }),
        log("2026-08-03", "Жим лёжа", { week: 1, day_order: 1 }),
        log("2026-08-10", "Присед", { week: 2, day_order: 1 }),
        log("2026-08-10", "Жим лёжа", { week: 2, day_order: 1 }),
      ],
      null,
      "2026-08-16",
    );
    expect(result.weeks[1].completed).toBe(1);
    expect(result.totalCompleted).toBe(2);
  });
});
