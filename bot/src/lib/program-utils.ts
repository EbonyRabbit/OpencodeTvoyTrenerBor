import type { Json } from "./types.js";

export type ParsedContent = {
  version?: number;
  program_name?: string;
  generated_at?: string;
  columns?: string[];
  weeks?: ParsedWeek[];
  notes?: string[];
};

export type ParsedWeek = {
  week_number: number;
  week_label?: string;
  is_deload?: boolean;
  days?: ParsedDay[];
};

export type ParsedDay = {
  day_name: string;
  day_order: number;
  focus?: string;
  exercises?: ParsedExercise[];
};

export type ExerciseType = "strength" | "cardio" | "superset" | "circuit";

export const EXERCISE_TYPES: ExerciseType[] = ["strength", "cardio", "superset", "circuit"];

export type ParsedExercise = {
  block?: string;
  name: string;
  sets?: string;
  reps?: string;
  weight?: string;
  rpe?: string;
  rest?: string;
  notes?: string;
  type?: ExerciseType;
  children?: ParsedExercise[];
  duration?: string;
  rounds?: string;
  distance?: string;
  pace?: string;
  heart_rate?: string;
};

function isValidParsedContent(value: unknown): value is ParsedContent {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (obj.version !== undefined && typeof obj.version !== "number") return false;
  if (obj.program_name !== undefined && typeof obj.program_name !== "string") return false;
  if (obj.generated_at !== undefined && typeof obj.generated_at !== "string") return false;
  if (obj.columns !== undefined && (!Array.isArray(obj.columns) || !obj.columns.every((c) => typeof c === "string"))) return false;
  if (obj.notes !== undefined && (!Array.isArray(obj.notes) || !obj.notes.every((n) => typeof n === "string"))) return false;
  if (obj.weeks !== undefined) {
    if (!Array.isArray(obj.weeks)) return false;
    for (const w of obj.weeks) {
      if (!isValidWeek(w)) return false;
    }
  }
  return true;
}

function isValidWeek(value: unknown): value is ParsedWeek {
  if (value === null || typeof value !== "object") return false;
  const w = value as Record<string, unknown>;
  if (typeof w.week_number !== "number" || !Number.isFinite(w.week_number)) return false;
  if (w.week_label !== undefined && typeof w.week_label !== "string") return false;
  if (w.is_deload !== undefined && typeof w.is_deload !== "boolean") return false;
  if (w.days !== undefined) {
    if (!Array.isArray(w.days)) return false;
    for (const d of w.days) {
      if (!isValidDay(d)) return false;
    }
  }
  return true;
}

function isValidDay(value: unknown): value is ParsedDay {
  if (value === null || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  if (typeof d.day_name !== "string") return false;
  if (typeof d.day_order !== "number" || !Number.isFinite(d.day_order)) return false;
  if (d.focus !== undefined && typeof d.focus !== "string") return false;
  if (d.exercises !== undefined) {
    if (!Array.isArray(d.exercises)) return false;
    for (const e of d.exercises) {
      if (!isValidExercise(e)) return false;
    }
  }
  return true;
}

export function getParsedContent(raw: Json | null): ParsedContent | null {
  if (isValidParsedContent(raw)) return raw;
  if (raw !== null) {
    console.warn("Invalid parsed_content format");
  }
  return null;
}

function isValidExercise(value: unknown, isChild = false): value is ParsedExercise {
  if (value === null || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  if (typeof e.name !== "string" || e.name.trim() === "") return false;
  if (e.type !== undefined && !EXERCISE_TYPES.includes(e.type as ExerciseType)) return false;
  const type = (e.type ?? "strength") as ExerciseType;
  if (isChild && (type === "superset" || type === "circuit")) return false;
  if (e.block !== undefined && typeof e.block !== "string") return false;
  if (e.sets !== undefined && typeof e.sets !== "string") return false;
  if (e.reps !== undefined && typeof e.reps !== "string") return false;
  if (e.weight !== undefined && typeof e.weight !== "string") return false;
  if (e.rpe !== undefined && typeof e.rpe !== "string") return false;
  if (e.rest !== undefined && typeof e.rest !== "string") return false;
  if (e.notes !== undefined && typeof e.notes !== "string") return false;
  if (e.duration !== undefined && typeof e.duration !== "string") return false;
  if (e.rounds !== undefined && typeof e.rounds !== "string") return false;
  if (e.distance !== undefined && typeof e.distance !== "string") return false;
  if (e.pace !== undefined && typeof e.pace !== "string") return false;
  if (e.heart_rate !== undefined && typeof e.heart_rate !== "string") return false;
  if (e.children !== undefined) {
    if (!Array.isArray(e.children)) return false;
    for (const child of e.children) {
      if (!isValidExercise(child, true)) return false;
    }
  }
  return true;
}

export function isCompositeExercise(exercise: ParsedExercise): boolean {
  return exercise.type === "superset" || exercise.type === "circuit";
}

const COMPOSITE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function getCompositeLetters(exercises: ParsedExercise[]): Map<number, string> {
  const map = new Map<number, string>();
  let n = 0;
  exercises.forEach((ex, i) => {
    if (isCompositeExercise(ex)) {
      map.set(i, n < COMPOSITE_LETTERS.length ? COMPOSITE_LETTERS[n] : `G${n + 1}`);
      n++;
    }
  });
  return map;
}

export function flattenLoggableExercises(exercises: ParsedExercise[]): ParsedExercise[] {
  const result: ParsedExercise[] = [];
  for (const ex of exercises) {
    if (ex.type === "superset" && ex.children && ex.children.length > 0) {
      result.push(...ex.children);
    } else {
      result.push(ex);
    }
  }
  return result;
}

export function buildSpreadsheetUrl(spreadsheetId: string | null): string | null {
  if (!spreadsheetId || spreadsheetId.trim() === "") return null;
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId.trim()}/edit`;
}

export function getTotalWeeks(parsed: ParsedContent | null): number {
  return parsed?.weeks?.length ?? 0;
}

export function getCurrentWeek(
  schedule: { week_number: number; start_date: string | null; end_date: string | null }[],
  todayStr: string,
): number | null {
  for (const week of schedule) {
    if (!week.start_date || !week.end_date) continue;
    if (todayStr >= week.start_date && todayStr <= week.end_date) {
      return week.week_number;
    }
  }
  return null;
}

export function getWorkoutDaysCount(parsed: ParsedContent | null, weekNumber: number): number {
  if (!parsed?.weeks) return 0;
  const week = parsed.weeks.find((w) => w.week_number === weekNumber);
  if (!week?.days) return 0;
  return week.days.filter((d) => (d.exercises?.length ?? 0) > 0).length;
}
