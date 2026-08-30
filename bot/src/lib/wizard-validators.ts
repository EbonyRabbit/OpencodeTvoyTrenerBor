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

  const rangeMatch = trimmed.match(/^(\d+)\s*[--]\s*(\d+)$/);
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

export function parseDurationSec(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.startsWith("-")) return null;
  const full = trimmed.match(/^(\d+)\s*:\s*(\d{1,2})\s*:\s*(\d{1,2})$/);
  if (full) {
    const h = Number(full[1]);
    const m = Number(full[2]);
    const s = Number(full[3]);
    if (m > 59 || s > 59) return null;
    const total = h * 3600 + m * 60 + s;
    if (total > 0 && total <= 86400) return String(total);
    return null;
  }

  const min = trimmed.match(/^(\d{1,3})\s*:\s*(\d{1,2})$/);
  if (min) {
    const m = Number(min[1]);
    const s = Number(min[2]);
    if (s > 59) return null;
    const total = m * 60 + s;
    if (total > 0 && total <= 86400) return String(total);
    return null;
  }

  let totalMinutes = 0;
  let totalSeconds = 0;
  const parts = trimmed.replace(/,/g, ".").match(/(\d+(?:\.\d+)?)\s*([а-яa-z]*)/g);
  if (!parts || parts.length === 0) return null;

  for (const part of parts) {
    const match = part.match(/^(\d+(?:\.\d+)?)\s*([а-яa-z]*)$/);
    if (!match) return null;
    const num = Number(match[1]);
    if (num <= 0) return null;
    const unit = match[2];
    if (unit.startsWith("сек") || unit.startsWith("s")) {
      totalSeconds += num;
    } else if (unit.startsWith("ч") || unit.startsWith("h")) {
      totalMinutes += num * 60;
    } else if (unit.startsWith("м")) {
      totalMinutes += num;
    } else {
      totalMinutes += num;
    }
  }

  const total = totalMinutes * 60 + totalSeconds;
  if (total > 0 && total <= 86400) return String(total);
  return null;
}

export function parseDistanceKm(input: string): string | null {
  const trimmed = input.trim().toLowerCase().replace(/,/g, ".").replace(/\s+/g, " ");
  if (!trimmed) return null;

  const km = trimmed.match(/^(\d+(?:\.\d+)?)\s*(?:км|km)?$/);
  if (km) {
    const num = Number(km[1]);
    if (num > 0 && num <= 500) return String(num);
    return null;
  }

  const meters = trimmed.match(/^(\d+(?:\.\d+)?)\s*(?:м|m)$/);
  if (meters) {
    const num = Number(meters[1]);
    if (num > 0 && num <= 200_000) return String(num / 1000);
    return null;
  }

  return null;
}

export function parsePace(input: string): string | null {
  const trimmed = input.trim().toLowerCase().replace(/\/км|\/км\/ч|\/кмч|\/km\/h|\/kmh|\/мин|мин\/км|км\/ч|km\/h/g, "").trim();
  if (!trimmed) return null;
  const time = trimmed.match(/^(\d{1,3})\s*:\s*(\d{2})$/);
  if (time) {
    const m = Number(time[1]);
    const s = Number(time[2]);
    if (s > 59 || m > 599) return null;
    return `${m}:${s}`;
  }
  const num = Number(trimmed.replace(",", "."));
  if (!isNaN(num) && num > 0 && num <= 30) return String(num);
  return null;
}

export function parseHeartRate(input: string): string | null {
  const trimmed = input.trim().toLowerCase().replace(/уд\/мин|уд\б|bpm|пульс/g, "").replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  const range = trimmed.match(/^(\d{2,3})\s*[--]\s*(\d{2,3})$/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (a >= 30 && a <= 250 && b >= 30 && b <= 250 && a <= b) return `${a}-${b}`;
    return null;
  }
  const num = Number(trimmed);
  if (Number.isInteger(num) && num >= 30 && num <= 250) return String(num);
  return null;
}

export function parseRounds(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "макс" || trimmed === "max" || trimmed === "максимум") return "МАКС";
  const num = Number(trimmed);
  if (Number.isInteger(num) && num >= 0 && num <= 99) return String(num);
  return null;
}

export const AMRAP_ROUNDS_SENTINEL = -1;

export function roundsValue(validated: string | undefined): number | null {
  if (!validated) return null;
  if (validated === "МАКС") return AMRAP_ROUNDS_SENTINEL;
  const num = Number(validated);
  if (!Number.isInteger(num) || num < 0) return null;
  return num;
}

export function heartRateValue(validated: string | undefined): number | null {
  if (!validated) return null;
  const range = validated.match(/^(\d{2,3})\s*[--]\s*(\d{2,3})$/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (a < 30 || b > 250 || a > b) return null;
    return Math.round((a + b) / 2);
  }
  const num = Number(validated);
  if (Number.isInteger(num) && num >= 30 && num <= 250) return num;
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
