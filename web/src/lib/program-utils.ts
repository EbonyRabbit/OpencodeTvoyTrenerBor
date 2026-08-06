import type { Database } from "@/types/supabase";

export type ProgramRow = Database["public"]["Tables"]["programs"]["Row"];

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

const DEFAULT_COLUMNS = ["Блок", "Упражнение", "Подходы", "Повторы", "Вес", "RPE", "Отдых", "Заметки"];

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

const MAX_CONTENT_BYTES = 512 * 1024; // 512 KB

export function validateProgramContent(content: unknown): { valid: boolean; error?: string } {
  if (!isValidParsedContent(content)) {
    return { valid: false, error: "Невалидная структура программы" };
  }
  const bytes = new TextEncoder().encode(JSON.stringify(content)).byteLength;
  if (bytes > MAX_CONTENT_BYTES) {
    return { valid: false, error: "Слишком большой объём данных (макс. 512 КБ)" };
  }
  return { valid: true };
}

export function getParsedContent(program: ProgramRow): ParsedContent | null {
  const raw = program.parsed_content;
  if (isValidParsedContent(raw)) return raw;
  if (raw !== null) {
    console.warn("Invalid parsed_content format for program", program.id);
  }
  return null;
}

export function hasContent(program: ProgramRow): boolean {
  return program.parsed_content !== null;
}

export function getColumns(parsed: ParsedContent): string[] {
  return parsed.columns ?? DEFAULT_COLUMNS;
}

export function getCellValue(exercise: ParsedExercise, column: string): string {
  const map: Record<string, string | undefined> = {
    "Блок": exercise.block,
    "Упражнение": exercise.name,
    "Подходы": exercise.sets,
    "Повторы": exercise.reps,
    "Вес": exercise.weight,
    "Вес/% 1ПМ": exercise.weight,
    "RPE": exercise.rpe,
    "Отдых": exercise.rest,
    "Заметки": exercise.notes,
    "Дистанция": exercise.distance,
    "Время": exercise.duration,
    "Темп": exercise.pace,
    "Пульс": exercise.heart_rate,
    "Раунды": exercise.rounds,
  };
  return map[column] ?? "—";
}

export const BLOCK_COLORS: Record<string, string> = {
  "Разминка": "bg-blue-50 dark:bg-blue-950/20",
  "Заминка": "bg-blue-50 dark:bg-blue-950/20",
  "Сила (основное)": "bg-primary/5",
  "Вспомогательные": "bg-green-50 dark:bg-green-950/20",
  "Руки": "bg-yellow-50 dark:bg-yellow-950/20",
};

const BLOCK_ORDER = Object.keys(BLOCK_COLORS);

function matchBlock(block: string): string | undefined {
  const blockLower = block.toLowerCase();
  for (const key of BLOCK_ORDER) {
    const keyLower = key.toLowerCase();
    const idx = blockLower.indexOf(keyLower);
    if (idx === -1) continue;
    const before = idx === 0 || blockLower[idx - 1] === " " || blockLower[idx - 1] === "/";
    const after =
      idx + keyLower.length >= blockLower.length ||
      blockLower[idx + keyLower.length] === " " ||
      blockLower[idx + keyLower.length] === "/";
    if (before && after) return key;
  }
  return undefined;
}

export function getBlockColor(block: string | undefined): string {
  if (!block) return "";
  const matched = matchBlock(block);
  return matched ? BLOCK_COLORS[matched] : "";
}
