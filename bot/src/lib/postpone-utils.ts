import type { Client } from "./clients.js";

export function getEffectiveTrainingDays(
  client: Client,
  weekRow: { training_days: number[] | null } | null,
): number[] | null {
  return weekRow?.training_days ?? client.training_days;
}

const MS_PER_DAY = 86_400_000;

function isoDayOfUTC(date: Date): number {
  const iso = date.getUTCDay();
  return iso === 0 ? 7 : iso;
}

function parseUTCDate(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00Z`);
}

export function weekdayDateInWeek(
  startDate: string,
  endDate: string | null,
  iso: number,
): string | null {
  if (iso < 1 || iso > 7) return null;

  const start = parseUTCDate(startDate);
  if (isNaN(start.getTime())) return null;

  const end = endDate
    ? parseUTCDate(endDate)
    : new Date(start.getTime() + 6 * MS_PER_DAY);
  if (isNaN(end.getTime()) || end < start) return null;

  const seen = new Set<number>();
  const cursor = new Date(start);
  while (cursor <= end) {
    const cursorIso = isoDayOfUTC(cursor);
    if (cursorIso === iso) {
      return cursor.toISOString().slice(0, 10);
    }
    seen.add(cursorIso);
    if (seen.size === 7) return null;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return null;
}

export function availablePostponeDays(todayStr: string, endDate: string | null): number[] {
  const start = parseUTCDate(todayStr);
  if (isNaN(start.getTime())) return [];

  const todayIso = isoDayOfUTC(start);
  const end = endDate
    ? parseUTCDate(endDate)
    : new Date(start.getTime() + (7 - todayIso) * MS_PER_DAY);

  if (isNaN(end.getTime()) || end < start) return [];

  const days: number[] = [];
  const seen = new Set<number>();
  const cursor = new Date(start.getTime() + MS_PER_DAY);

  while (cursor <= end) {
    const iso = isoDayOfUTC(cursor);
    if (!seen.has(iso)) {
      seen.add(iso);
      days.push(iso);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

export function replaceTrainingDay(days: number[], removeIso: number, addIso: number): number[] {
  const idx = days.indexOf(removeIso);
  if (idx === -1) return [...days];
  if (days.includes(addIso)) return days.filter((d) => d !== removeIso);
  const next = [...days];
  next[idx] = addIso;
  return next;
}

export type DayAvailability =
  | { ok: true }
  | { ok: false; reason: "occupied" | "not_in_week" };

export function dayAvailability(
  iso: number,
  available: number[],
  occupied: number[],
): DayAvailability {
  if (!available.includes(iso)) return { ok: false, reason: "not_in_week" };
  if (occupied.includes(iso)) return { ok: false, reason: "occupied" };
  return { ok: true };
}