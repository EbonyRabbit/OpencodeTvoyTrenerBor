import type { PauseReason } from "./types.js";

export function parseSets(input: string): string | null {
  const trimmed = input.trim();
  const num = Number(trimmed);
  if (Number.isInteger(num) && num > 0 && num <= 100) return String(num);
  return null;
}

export function repsListMatchesSets(reps: string, sets?: string): boolean {
  if (!reps.includes("/")) return true;
  const setsCount = Number(sets);
  if (!Number.isInteger(setsCount) || setsCount <= 0) return true;
  return reps.split("/").length === setsCount;
}

export function parseReps(input: string): string | null {
  const trimmed = input.trim();

  if (trimmed.includes("/")) {
    const parts = trimmed
      .split("/")
      .map((p) => p.trim());
    if (parts.length < 2 || parts.length > 100) return null;
    const nums: number[] = [];
    for (const part of parts) {
      if (!/^\d+$/.test(part)) return null;
      const num = Number(part);
      if (num <= 0 || num > 100) return null;
      nums.push(num);
    }
    return nums.join("/");
  }

  const rangeMatch = trimmed.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (rangeMatch) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    if (a > 0 && b > 0 && a <= 100 && b <= 100) {
      return `${a}-${b}`;
    }
  }

  const num = Number(trimmed);
  if (Number.isInteger(num) && num > 0 && num <= 100) return String(num);
  return null;
}

export function parseWeight(input: string): string | null {
  const trimmed = input.trim().toLowerCase().replace(/кг|kg/, "").replace(",", ".").trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!isNaN(num) && num >= 0 && num <= 1000) return String(num);
  return null;
}

export function parseRpe(input: string): string | null {
  const trimmed = input.trim().toLowerCase().replace(/rpe\s*:?\s*|rir\s*:?\s*/g, "").trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (Number.isInteger(num) && num >= 1 && num <= 10) return String(num);
  return null;
}

export function parseMeasurement(input: string): string | null {
  const trimmed = input.trim().toLowerCase().replace(/кг|kg|см|cm/g, "").replace(",", ".").trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!isNaN(num) && num >= 0 && num <= 300) return String(num);
  return null;
}

export function parseScale1to10(input: string): string | null {
  const trimmed = input.trim();
  const num = Number(trimmed);
  if (Number.isInteger(num) && num >= 1 && num <= 10) return String(num);
  return null;
}

export function parseHours(input: string): string | null {
  const trimmed = input.trim().toLowerCase().replace(/час|hour/g, "").trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!isNaN(num) && num >= 0 && num <= 24) return String(num);
  return null;
}

export function parsePercentage(input: string): string | null {
  const trimmed = input.trim().replace(/%/, "").trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!isNaN(num) && num >= 0 && num <= 100) return String(num);
  return null;
}

export function parseCount(input: string): string | null {
  const trimmed = input.trim();
  const num = Number(trimmed);
  if (Number.isInteger(num) && num >= 0 && num <= 30) return String(num);
  return null;
}

export function parseDate(input: string): string | null {
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const [, year, month, day] = match;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);

  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;

  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }

  return `${year}-${month}-${day}`;
}

const PAUSE_REASON_MAP: Record<string, PauseReason> = {
  "1": "sick",
  "2": "vacation",
  "3": "injury",
  "4": "personal",
  "5": "other",
  sick: "sick",
  болезнь: "sick",
  vacation: "vacation",
  отпуск: "vacation",
  injury: "injury",
  травма: "injury",
  personal: "personal",
  личное: "personal",
  other: "other",
  другое: "other",
};

export function parsePauseReason(input: string): PauseReason | null {
  return PAUSE_REASON_MAP[input.trim().toLowerCase()] ?? null;
}
