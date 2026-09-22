import { describe, it, expect } from "vitest";
import { calcCalories, parseWeightKg } from "../../lib/calorie-calc.js";

describe("calcCalories 31/35", () => {
  it("female 60kg maintain", () => {
    const r = calcCalories("F", 60, "maintain");
    expect(r.maintenance).toBe(1860);
    expect(r.proteinG).toBe(90);
    expect(r.fatG).toBe(60);
    expect(r.carbsG).toBe(240);
    expect(r.targetCalories).toBe(1860);
  });

  it("male 80kg cut -20%", () => {
    const r = calcCalories("M", 80, "cut");
    expect(r.maintenance).toBe(2800);
    expect(r.targetCalories).toBe(2240);
    expect(r.targetProteinG).toBe(160);
    expect(r.targetFatG).toBe(80);
    expect(r.targetCarbsG).toBe(220);
  });

  it("male 80kg bulk +10%", () => {
    const r = calcCalories("M", 80, "bulk");
    expect(r.targetCalories).toBe(3080);
    expect(r.targetCarbsG).toBe(430);
  });

  it("female 68kg exact like guide", () => {
    const r = calcCalories("F", 68, "maintain");
    expect(r.maintenance).toBe(2108);
    expect(r.proteinG).toBe(102);
    expect(r.fatG).toBe(68);
    expect(r.carbsG).toBe(272);
    const cut = calcCalories("F", 68, "cut");
    expect(cut.targetCalories).toBe(1686);
    const bulk = calcCalories("F", 68, "bulk");
    expect(bulk.targetCalories).toBe(2319);
    expect(bulk.targetCarbsG).toBe(325);
  });
});

describe("parseWeightKg", () => {
  it("parses dots and commas", () => {
    expect(parseWeightKg("82")).toBe(82);
    expect(parseWeightKg("68,5")).toBe(68.5);
    expect(parseWeightKg("80 кг")).toBe(80);
  });

  it("rejects out of range and negatives", () => {
    expect(parseWeightKg("20")).toBeNull();
    expect(parseWeightKg("300")).toBeNull();
    expect(parseWeightKg("abc")).toBeNull();
    expect(parseWeightKg("-5")).toBeNull();
    expect(parseWeightKg("82..5")).toBeNull();
  });
});
