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

export type ParsedExercise = {
  block?: string;
  name: string;
  sets?: string;
  reps?: string;
  weight?: string;
  rpe?: string;
  rest?: string;
  notes?: string;
};

function isValidParsedContent(value: unknown): value is ParsedContent {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (obj.version !== undefined && typeof obj.version !== "number") return false;
  if (obj.program_name !== undefined && typeof obj.program_name !== "string") return false;
  if (obj.generated_at !== undefined && typeof obj.generated_at !== "string") return false;
  if (obj.columns !== undefined && (!Array.isArray(obj.columns) || !obj.columns.every((c) => typeof c === "string"))) return false;
  if (obj.notes !== undefined && (!Array.isArray(obj.notes) || !obj.notes.every((n) => typeof n === "string"))) return false;
  if (obj.weeks !== undefined && !Array.isArray(obj.weeks)) return false;
  return true;
}

export function getParsedContent(raw: Json | null): ParsedContent | null {
  if (isValidParsedContent(raw)) return raw;
  if (raw !== null) {
    console.warn("Invalid parsed_content format");
  }
  return null;
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
