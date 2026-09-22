export type GuideSex = "F" | "M";
export type GuideGoal = "cut" | "bulk" | "maintain";

export interface CalorieResult {
  maintenance: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  targetCalories: number;
  targetProteinG: number;
  targetFatG: number;
  targetCarbsG: number;
}

function roundInt(x: number): number {
  return Math.round(x);
}

export function calcCalories(sex: GuideSex, weightKg: number, goal: GuideGoal): CalorieResult {
  const w = weightKg;
  const maintenance = sex === "F" ? w * 31 : w * 35;
  const proteinG = sex === "F" ? w * 1.5 : w * 2;
  const fatG = w * 1;
  const carbsG = (maintenance - proteinG * 4 - fatG * 9) / 4;

  const factor = goal === "cut" ? 0.8 : goal === "bulk" ? 1.1 : 1;
  const targetCaloriesRaw = maintenance * factor;
  // Keep macros anchored to body weight, recalc carbs for target
  const targetProteinG = proteinG;
  const targetFatG = fatG;
  const targetCarbsG = (targetCaloriesRaw - targetProteinG * 4 - targetFatG * 9) / 4;

  return {
    maintenance: roundInt(maintenance),
    proteinG: Math.round(proteinG),
    fatG: Math.round(fatG),
    carbsG: Math.round(carbsG),
    targetCalories: roundInt(targetCaloriesRaw),
    targetProteinG: Math.round(targetProteinG),
    targetFatG: Math.round(targetFatG),
    targetCarbsG: Math.round(targetCarbsG),
  };
}

export function parseWeightKg(raw: string): number | null {
  if (/[-+]/.test(raw)) return null;
  const normalized = raw.replace(",", ".").replace(/[^\d.]/g, "");
  if (!normalized) return null;
  if (normalized.split(".").length > 2) return null;
  const v = Number(normalized);
  if (!Number.isFinite(v)) return null;
  if (v < 35 || v > 250) return null;
  return Math.round(v * 10) / 10;
}
