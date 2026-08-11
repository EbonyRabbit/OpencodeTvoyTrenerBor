import { describe, it, expect } from "vitest";
import { getNextWorkoutDay } from "../next-workout";
import type { ParsedContent } from "../program-utils";

const parsed: ParsedContent = {
  weeks: [
    {
      week_number: 1,
      days: [
        { day_name: "Понедельник", day_order: 1, exercises: [{ name: "Жим лежа" }, { name: "Присед" }] },
        { day_name: "Среда", day_order: 2, exercises: [{ name: "Тяга" }] },
        { day_name: "Пятница", day_order: 3, exercises: [{ name: "Становая" }] },
      ],
    },
    {
      week_number: 2,
      days: [
        { day_name: "Вторник", day_order: 1, exercises: [{ name: "Жим лежа" }] },
        { day_name: "Четверг", day_order: 2, exercises: [{ name: "Присед" }] },
      ],
    },
    {
      week_number: 3,
      days: [
        { day_name: "Воскресенье", day_order: 1, exercises: [{ name: "Становая" }] },
      ],
    },
  ],
};

const schedule = [
  { week_number: 1, start_date: "2026-08-03", end_date: "2026-08-09", training_days: null },
  { week_number: 2, start_date: "2026-08-10", end_date: "2026-08-16", training_days: null },
  { week_number: 3, start_date: "2026-08-17", end_date: "2026-08-23", training_days: null },
];

describe("getNextWorkoutDay", () => {
  it("returns today when it is a training day and not completed", () => {
    const next = getNextWorkoutDay({
      schedule,
      clientTrainingDays: [1, 3, 5],
      parsed,
      workoutLogs: [],
      today: "2026-08-10",
    });
    expect(next).toEqual({
      date: "2026-08-10",
      iso: 1,
      weekNumber: 2,
      isToday: true,
    });
  });

  it("skips today when completed and returns the next training day", () => {
    const next = getNextWorkoutDay({
      schedule,
      clientTrainingDays: [1, 3, 5],
      parsed,
      workoutLogs: [
        { date: "2026-08-10", exercise: "Жим лежа", week: 2, day_order: 1 },
      ],
      today: "2026-08-10",
    });
    expect(next).toEqual({
      date: "2026-08-12",
      iso: 3,
      weekNumber: 2,
      isToday: false,
    });
  });

  it("applies week override over client training days", () => {
    const weekOverride = [
      { week_number: 1, start_date: "2026-08-03", end_date: "2026-08-09", training_days: null },
      { week_number: 2, start_date: "2026-08-10", end_date: "2026-08-16", training_days: [4] },
    ];
    const next = getNextWorkoutDay({
      schedule: weekOverride,
      clientTrainingDays: [1],
      parsed,
      workoutLogs: [],
      today: "2026-08-10",
    });
    expect(next).toEqual({
      date: "2026-08-13",
      iso: 4,
      weekNumber: 2,
      isToday: false,
    });
  });

  it("crosses week boundary when no days remain in current week", () => {
    const next = getNextWorkoutDay({
      schedule,
      clientTrainingDays: [7],
      parsed,
      workoutLogs: [
        { date: "2026-08-16", exercise: "Жим лежа", week: 2, day_order: 1 },
      ],
      today: "2026-08-16",
    });
    expect(next).toEqual({
      date: "2026-08-23",
      iso: 7,
      weekNumber: 3,
      isToday: false,
    });
  });

  it("falls back to day_order when training days are not set", () => {
    const next = getNextWorkoutDay({
      schedule,
      clientTrainingDays: null,
      parsed,
      workoutLogs: [],
      today: "2026-08-10",
    });
    expect(next).toEqual({
      date: "2026-08-11",
      iso: 2,
      weekNumber: 2,
      isToday: false,
    });
  });

  it("ignores pseudo logs like [MORNING_POSTPONE]", () => {
    const next = getNextWorkoutDay({
      schedule,
      clientTrainingDays: [1, 3, 5],
      parsed,
      workoutLogs: [
        { date: "2026-08-10", exercise: "[MORNING_POSTPONE]" },
      ],
      today: "2026-08-10",
    });
    expect(next).toEqual({
      date: "2026-08-10",
      iso: 1,
      weekNumber: 2,
      isToday: true,
    });
  });

  it("returns null for empty schedule", () => {
    const next = getNextWorkoutDay({
      schedule: [],
      clientTrainingDays: [1],
      parsed,
      workoutLogs: [],
      today: "2026-08-10",
    });
    expect(next).toBeNull();
  });

  it("returns null when today is after the last week", () => {
    const next = getNextWorkoutDay({
      schedule,
      clientTrainingDays: [1],
      parsed,
      workoutLogs: [],
      today: "2026-08-30",
    });
    expect(next).toBeNull();
  });

  it("starts from the first future week when today is before the schedule", () => {
    const next = getNextWorkoutDay({
      schedule,
      clientTrainingDays: [1],
      parsed,
      workoutLogs: [],
      today: "2026-08-02",
    });
    expect(next).toEqual({
      date: "2026-08-03",
      iso: 1,
      weekNumber: 1,
      isToday: false,
    });
  });

  it("returns null when parsed content is missing", () => {
    const next = getNextWorkoutDay({
      schedule,
      clientTrainingDays: [1],
      parsed: null,
      workoutLogs: [],
      today: "2026-08-10",
    });
    expect(next).toBeNull();
  });

  it("falls back to day_order mode when week override is an empty array", () => {
    const weekOverride = [
      { week_number: 1, start_date: "2026-08-03", end_date: "2026-08-09", training_days: null },
      { week_number: 2, start_date: "2026-08-10", end_date: "2026-08-16", training_days: [] },
      { week_number: 3, start_date: "2026-08-17", end_date: "2026-08-23", training_days: null },
    ];
    const next = getNextWorkoutDay({
      schedule: weekOverride,
      clientTrainingDays: [1],
      parsed,
      workoutLogs: [],
      today: "2026-08-10",
    });
    expect(next).toEqual({
      date: "2026-08-11",
      iso: 2,
      weekNumber: 2,
      isToday: false,
    });
  });

  it("skips a completed day in day_order mode via week+day_order logs", () => {
    const next = getNextWorkoutDay({
      schedule,
      clientTrainingDays: null,
      parsed,
      workoutLogs: [
        { date: "2026-08-11", exercise: "Жим лежа", week: 2, day_order: 1 },
      ],
      today: "2026-08-10",
    });
    expect(next).toEqual({
      date: "2026-08-13",
      iso: 4,
      weekNumber: 2,
      isToday: false,
    });
  });

  it("returns today in day_order mode when the day is not completed", () => {
    const dayOrderSchedule = [
      { week_number: 1, start_date: "2026-08-10", end_date: "2026-08-16", training_days: null },
    ];
    const dayOrderParsed: ParsedContent = {
      weeks: [
        {
          week_number: 1,
          days: [
            { day_name: "Понедельник", day_order: 1, exercises: [{ name: "Жим лежа" }] },
          ],
        },
      ],
    };
    const next = getNextWorkoutDay({
      schedule: dayOrderSchedule,
      clientTrainingDays: null,
      parsed: dayOrderParsed,
      workoutLogs: [],
      today: "2026-08-10",
    });
    expect(next).toEqual({
      date: "2026-08-10",
      iso: 1,
      weekNumber: 1,
      isToday: true,
    });
  });

  it("skips a day completed early by week+day_order log not on the planned date", () => {
    const weekOne = [
      { week_number: 1, start_date: "2026-08-03", end_date: "2026-08-09", training_days: null },
    ];
    const next = getNextWorkoutDay({
      schedule: weekOne,
      clientTrainingDays: null,
      parsed,
      workoutLogs: [
        { date: "2026-08-04", exercise: "Тяга", week: 1, day_order: 2 },
      ],
      today: "2026-08-05",
    });
    expect(next).toEqual({
      date: "2026-08-07",
      iso: 5,
      weekNumber: 1,
      isToday: false,
    });
  });

  it("treats legacy day_order=null log on the planned date as completion", () => {
    const next = getNextWorkoutDay({
      schedule,
      clientTrainingDays: null,
      parsed,
      workoutLogs: [
        { date: "2026-08-07", exercise: "Становая" },
      ],
      today: "2026-08-07",
    });
    expect(next).toEqual({
      date: "2026-08-11",
      iso: 2,
      weekNumber: 2,
      isToday: false,
    });
  });

  it("crosses week boundary in day_order mode when current week is done", () => {
    const next = getNextWorkoutDay({
      schedule,
      clientTrainingDays: null,
      parsed,
      workoutLogs: [
        { date: "2026-08-11", exercise: "Жим лежа", week: 2, day_order: 1 },
        { date: "2026-08-13", exercise: "Присед", week: 2, day_order: 2 },
      ],
      today: "2026-08-13",
    });
    expect(next).toEqual({
      date: "2026-08-23",
      iso: 7,
      weekNumber: 3,
      isToday: false,
    });
  });
});