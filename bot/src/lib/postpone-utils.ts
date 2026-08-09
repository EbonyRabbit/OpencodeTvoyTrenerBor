import type { Client } from "./clients.js";

export interface WeekOverrideRow {
  id: string;
  week_number: number;
  start_date: string | null;
  end_date: string | null;
  training_days: number[] | null;
}

export function getEffectiveTrainingDays(
  client: Client,
  weekRow: { training_days: number[] | null } | null,
): number[] | null {
  return weekRow?.training_days ?? client.training_days;
}

export function weekdayOfDate(dateStr: string | null): number {
  if (!dateStr) return 7;
  const date = new Date(`${dateStr}T12:00:00Z`);
  if (isNaN(date.getTime())) return 7;
  const iso = date.getUTCDay();
  return iso === 0 ? 7 : iso;
}

export function availablePostponeDays(todayIso: number, endDate: string | null): number[] {
  const lastIso = endDate ? weekdayOfDate(endDate) : 7;
  const days: number[] = [];
  for (let iso = todayIso + 1; iso <= 7 && iso <= lastIso; iso++) {
    days.push(iso);
  }
  return days;
}

export function replaceTrainingDay(days: number[], removeIso: number, addIso: number): number[] {
  const filtered = days.filter((d) => d !== removeIso);
  if (filtered.includes(addIso)) return [...filtered].sort((a, b) => a - b);
  return [...filtered, addIso].sort((a, b) => a - b);
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