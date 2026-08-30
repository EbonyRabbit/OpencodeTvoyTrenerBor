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

  it("counts a partial workout as a trained day", () => {
    const result = calculateAdherence(
      SCHEDULE,
      MON_WED_FRI_WEEK,
      [log("2026-08-03", "Присед")],
      TRAINING_DAYS,
      "2026-08-16",
    );
    expect(result.weeks[0].completed).toBe(1);
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

  it("ignores pseudo-only days but counts a real off-plan workout on a rest day", () => {
    const result = calculateAdherence(
      SCHEDULE,
      MON_WED_FRI_WEEK,
      [log("2026-08-04", "[EVENING_ФОТО]"), log("2026-08-04", "Присед")],
      TRAINING_DAYS,
      "2026-08-16",
    );
    expect(result.weeks[0].expected).toBe(3);
    expect(result.weeks[0].completed).toBe(1);
  });

  it("does not count a day with only pseudo logs", () => {
    const result = calculateAdherence(
      SCHEDULE,
      MON_WED_FRI_WEEK,
      [log("2026-08-04", "[SKIP]"), log("2026-08-04", "[EVENING_ФОТО]")],
      TRAINING_DAYS,
      "2026-08-16",
    );
    expect(result.weeks[0].completed).toBe(0);
  });

  it("counts a workout done off-plan (on a rest day)", () => {
    // Клиент потренировался во вторник (не плановый день) - день засчитан.
    const result = calculateAdherence(
      SCHEDULE,
      MON_WED_FRI_WEEK,
      [log("2026-08-04", "Тяга"), log("2026-08-04", "Присед")],
      TRAINING_DAYS,
      "2026-08-09",
    );
    expect(result.weeks[0].completed).toBe(1);
    expect(result.weeks[0].expected).toBe(3);
  });

  it("does not count trained days after today in the current week", () => {
    const result = calculateAdherence(
      SCHEDULE,
      MON_WED_FRI_WEEK,
      [log("2026-08-08", "Присед")],
      TRAINING_DAYS,
      "2026-08-05",
    );
    expect(result.weeks[0].completed).toBe(0);
    expect(result.weeks[0].expected).toBe(2);
  });

  it("ignores pseudo exercises in the program plan", () => {
    const parsed: ParsedContent = {
      weeks: [{
        week_number: 1,
        days: [{
          day_order: 1,
          day_name: "Понедельник",
          exercises: [{ name: "Присед" }, { name: "[EVENING_ФОТО]" }],
        }],
      }],
    };
    const result = calculateAdherence(
      [SCHEDULE[0]],
      parsed,
      [log("2026-08-03", "Присед")],
      [1],
      "2026-08-07",
    );
    expect(result.weeks[0].completed).toBe(1);
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

  it("counts a partial day in fallback path as a trained day", () => {
    const result = calculateAdherence(
      SCHEDULE,
      MON_WED_FRI_WEEK,
      [log("2026-08-03", "Присед", { week: 1, day_order: 1 })],
      null,
      "2026-08-16",
    );
    expect(result.weeks[0].completed).toBe(1);
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

  it("counts each distinct trained day once even with several logs", () => {
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
    expect(result.weeks[0].completed).toBe(2);
    expect(result.totalCompleted).toBe(2);
  });

  it("counts the date as trained regardless of stored day_order mismatch", () => {
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
    expect(result.weeks[0].completed).toBe(1);
  });

  it("maps legacy planned dates inside a mid-week anchored window", () => {
    // Week starts Wednesday 2026-08-05: plan days Пн/Ср/Пт fall on
    // 2026-08-10 / 2026-08-05 / 2026-08-07 (Monday-anchored math would
    // misplace Monday at 08-05, colliding with Wednesday)
    const midWeekSchedule = [
      { week_number: 1, start_date: "2026-08-05", end_date: "2026-08-11", focus: null },
    ];
    const result = calculateAdherence(
      midWeekSchedule,
      MON_WED_FRI_WEEK,
      [
        log("2026-08-05", "Тяга", { week: 1 }),
        log("2026-08-10", "Присед", { week: 1 }),
        log("2026-08-10", "жим лёжа", { week: 1 }),
      ],
      null,
      "2026-08-11",
    );
    expect(result.weeks[0].completed).toBe(2);
    expect(result.weeks[0].expected).toBe(3);
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

describe("calculateAdherence (week training_days override)", () => {
  it("uses the per-week override for week 1 and the global days for week 2", () => {
    const schedule = [
      { week_number: 1, start_date: "2026-08-03", end_date: "2026-08-09", focus: null, training_days: [2, 3, 5] },
      { week_number: 2, start_date: "2026-08-10", end_date: "2026-08-16", focus: null, training_days: null },
    ];
    // Tue 08-04 (day 1 -> Присед+Жим лёжа) completed; Mon 08-03 no longer a day.
    const result = calculateAdherence(
      schedule,
      MON_WED_FRI_WEEK,
      [log("2026-08-04", "Присед"), log("2026-08-04", "Жим лёжа")],
      TRAINING_DAYS,
      "2026-08-16",
    );
    expect(result.weeks[0].completed).toBe(1);
    expect(result.weeks[0].expected).toBe(3);
  });
});
