import { describe, it, expect } from "vitest";
import { formatMetrics, formatPlannedChild } from "./history-format";

describe("formatMetrics", () => {
  it("hides duration when rounds are present (circuit)", () => {
    const metrics = formatMetrics({
      exercise: "Круг",
      weight: null,
      sets: null,
      reps: null,
      rpe: null,
      rounds: 4,
      distance_km: null,
      duration_sec: 900,
      heart_rate: null,
      pace: null,
      comment: null,
      date: "2026-07-27",
    });
    expect(metrics).toContain("4 раунд.");
    expect(metrics.join(" · ")).not.toContain("мин");
  });

  it("keeps duration when rounds are absent (cardio)", () => {
    const metrics = formatMetrics({
      exercise: "Бег",
      weight: null,
      sets: null,
      reps: null,
      rpe: null,
      rounds: null,
      distance_km: 5,
      duration_sec: 1500,
      heart_rate: 145,
      pace: "5:00",
      comment: null,
      date: "2026-07-27",
    });
    expect(metrics).toContain("5 км");
    expect(metrics).toContain("25 мин");
    expect(metrics).toContain("пульс 145");
  });

  it("shows МАКС раундов for unlimited rounds", () => {
    const metrics = formatMetrics({
      exercise: "Круг",
      weight: null,
      sets: null,
      reps: null,
      rpe: null,
      rounds: -1,
      distance_km: null,
      duration_sec: null,
      heart_rate: null,
      pace: null,
      comment: null,
      date: "2026-07-27",
    });
    expect(metrics).toEqual(["МАКС раундов"]);
  });
});

describe("formatPlannedChild", () => {
  it("formats circuit child with letter, sets and weight", () => {
    const result = formatPlannedChild({ name: "Берпи", sets: "3", reps: "15", weight: "20" }, "A", 0);
    expect(result).toBe("A1. Берпи - 3×15 · 20 кг");
  });

  it("formats bodyweight child without kg", () => {
    const result = formatPlannedChild({ name: "Отжимания", sets: "3", reps: "15", weight: "0" }, "B", 1);
    expect(result).toBe("B2. Отжимания - 3×15 · вес тела");
  });

  it("formats sets-only child with подх fallback", () => {
    const result = formatPlannedChild({ name: "Планка", sets: "4" }, null, 2);
    expect(result).toBe("Планка - 4 подх.");
  });

  it("renders bare name when no metrics", () => {
    const result = formatPlannedChild({ name: "Растяжка" }, "C", 0);
    expect(result).toBe("C1. Растяжка");
  });
});
