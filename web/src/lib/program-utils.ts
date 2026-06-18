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

const DEFAULT_COLUMNS = ["Блок", "Упражнение", "Подходы", "Повторы", "Вес", "RPE", "Отдых", "Заметки"];

function isValidParsedContent(value: unknown): value is ParsedContent {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (obj.version !== undefined && typeof obj.version !== "number") return false;
  if (obj.program_name !== undefined && typeof obj.program_name !== "string") return false;
  if (obj.generated_at !== undefined && typeof obj.generated_at !== "string") return false;
  if (obj.columns !== undefined && (!Array.isArray(obj.columns) || !obj.columns.every((c) => typeof c === "string"))) return false;
  if (obj.notes !== undefined && (!Array.isArray(obj.notes) || !obj.notes.every((n) => typeof n === "string"))) return false;
  return true;
}

export function getParsedContent(program: ProgramRow): ParsedContent | null {
  const raw = program.parsed_content;
  if (isValidParsedContent(raw)) return raw;
  if (raw !== null) {
    console.warn("Invalid parsed_content format for program", program.id);
  }
  return null;
}

export function hasTemplate(program: ProgramRow): boolean {
  return program.template_file_url !== null;
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
