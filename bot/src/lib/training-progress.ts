export interface RepRange {
  min: number;
  max: number;
}

export interface TargetLog {
  weight: number | null;
  sets: number | null;
  reps: string | null;
  date?: string | null;
}

export interface SuggestTargetInput {
  exerciseName?: string;
  plannedWeight?: string | null;
  plannedSets?: string | null;
  plannedReps?: string | null;
  lastLog?: TargetLog | null;
  equipment?: string | null;
  isDeload?: boolean;
  isSwapped?: boolean;
  today?: string;
}

export interface ExerciseTarget {
  weightKg: number | null;
  repsMin: number;
  repsMax: number;
  source: "plan" | "history";
}

function parseNumber(value: unknown): number | null {
  if (value == null) return null;
  const match = String(value).replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseWeightKg(value: unknown): number | null {
  if (value == null) return null;
  const normalized = String(value).trim().replace(",", ".");
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(?:кг|kg)?$/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeEquipment(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/ё/g, "е");
}

export function parseRepsToSets(reps: string | null | undefined): number[] | null {
  if (!reps) return null;
  const parts = reps.trim().split("/");
  if (parts.length === 0) return null;
  const sets: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part.trim())) return null;
    const value = Number(part);
    if (!Number.isInteger(value) || value <= 0) return null;
    sets.push(value);
  }
  return sets;
}

export function parseTargetReps(reps: string | null | undefined): RepRange | null {
  if (!reps) return null;
  const normalized = reps.trim().replace(/[–—]/g, "-");
  const match = normalized.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
  if (!match) return null;
  const min = Number(match[1]);
  const max = match[2] ? Number(match[2]) : min;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min <= 0) return null;
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

export function weightStepFor(equipment: string | null | undefined): number {
  const value = normalizeEquipment(equipment);
  if (/гравитрон|assisted|противовес/.test(value)) return 5;
  if (/штанг/.test(value)) return 2.5;
  if (/гантел/.test(value)) return 2;
  if (/гир/.test(value)) return 4;
  if (/тренаж|блок|смит/.test(value)) return 5;
  return 0;
}

export function isAssistedExercise(
  name: string,
  equipment?: string | null,
): boolean {
  return /гравитрон|assisted|противовес/i.test(`${name} ${equipment ?? ""}`);
}

export function calculateE1rm(weight: number, reps: number): number {
  if (!Number.isFinite(weight) || !Number.isFinite(reps) || weight <= 0 || reps <= 0) {
    return 0;
  }
  const effectiveReps = Math.min(reps, 10);
  return Math.round(weight * (1 + effectiveReps / 30) * 10) / 10;
}

export function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(step) || step <= 0) {
    return Math.round(value * 10) / 10;
  }
  return Number((Math.round(value / step) * step).toFixed(2));
}

export function daysBetweenIso(from: string, to: string): number | null {
  const fromMatch = from.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const toMatch = to.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!fromMatch || !toMatch) return null;
  const fromUtc = Date.UTC(
    Number(fromMatch[1]),
    Number(fromMatch[2]) - 1,
    Number(fromMatch[3]),
  );
  const toUtc = Date.UTC(
    Number(toMatch[1]),
    Number(toMatch[2]) - 1,
    Number(toMatch[3]),
  );
  if (!Number.isFinite(fromUtc) || !Number.isFinite(toUtc)) return null;
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

function isRepRange(value: string | null | undefined): boolean {
  return Boolean(value && parseRepsToSets(value) === null && parseTargetReps(value));
}

export function suggestTarget(input: SuggestTargetInput): ExerciseTarget | null {
  const planReps = parseTargetReps(input.plannedReps);
  if (!planReps) return null;

  const planWeight = parseWeightKg(input.plannedWeight);
  const positivePlanWeight = planWeight != null && planWeight > 0 ? planWeight : null;
  const last = input.lastLog ?? null;

  if (!last) {
    if (input.isSwapped) return null;
    if (positivePlanWeight != null) {
      return {
        weightKg: positivePlanWeight,
        repsMin: planReps.min,
        repsMax: planReps.max,
        source: "plan",
      };
    }
    if (planWeight === 0) {
      return {
        weightKg: null,
        repsMin: planReps.min,
        repsMax: planReps.max,
        source: "plan",
      };
    }
    return null;
  }

  const planSets = parseNumber(input.plannedSets);
  const baseWeight =
    last.weight != null && Number.isFinite(last.weight) && last.weight > 0
      ? last.weight
      : null;

  if (baseWeight == null) {
    return {
      weightKg: null,
      repsMin: planReps.min,
      repsMax: planReps.max,
      source: "history",
    };
  }

  const assisted = isAssistedExercise(input.exerciseName ?? "", input.equipment);
  const rawStep = weightStepFor(input.equipment);
  const step = assisted && rawStep === 0 ? 5 : rawStep;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const gap = last.date ? daysBetweenIso(last.date, today) : null;

  let factor = 1;
  if (input.isDeload) factor = Math.min(factor, 0.8);
  if (gap != null && gap > 21) factor = Math.min(factor, 0.7);
  else if (gap != null && gap > 10) factor = Math.min(factor, 0.8);

  if (factor < 1) {
    const raw = assisted ? baseWeight / factor : baseWeight * factor;
    let weightKg = roundToStep(raw, step || 1);
    if (!assisted && weightKg >= baseWeight) {
      weightKg = Math.max(0, baseWeight - (step || 1));
    }
    if (assisted && weightKg <= baseWeight) {
      weightKg = baseWeight + (step || 1);
    }
    return {
      weightKg: weightKg > 0 ? weightKg : null,
      repsMin: planReps.min,
      repsMax: planReps.min,
      source: "history",
    };
  }

  const actualSets = parseRepsToSets(last.reps);
  const actualCount =
    actualSets != null && actualSets.length === 1 && last.sets != null
      ? last.sets
      : actualSets?.length ?? last.sets ?? null;
  const hasLessSets =
    planSets != null &&
    planSets > 0 &&
    actualCount != null &&
    actualCount < planSets;

  if (hasLessSets || isRepRange(last.reps) || step === 0) {
    return {
      weightKg: baseWeight,
      repsMin: planReps.min,
      repsMax: planReps.max,
      source: "history",
    };
  }

  const actualMin = actualSets ? Math.min(...actualSets) : null;
  const completedAllSets =
    actualMin != null &&
    actualMin >= planReps.max &&
    (planSets == null || (actualCount != null && actualCount >= planSets));

  if (completedAllSets) {
    const nextWeight = assisted
      ? Math.max(0, baseWeight - step)
      : baseWeight + step;
    return {
      weightKg: nextWeight > 0 ? nextWeight : null,
      repsMin: planReps.min,
      repsMax: planReps.max,
      source: "history",
    };
  }

  const repsMin = actualMin == null
    ? planReps.min
    : Math.max(planReps.min, Math.min(planReps.max, actualMin + 1));

  return {
    weightKg: baseWeight,
    repsMin,
    repsMax: Math.max(repsMin, planReps.max),
    source: "history",
  };
}
