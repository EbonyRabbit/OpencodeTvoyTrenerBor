export type HistoryEntry = {
  exercise: string;
  weight: number | null;
  sets: number | null;
  reps: string | null;
  rpe: number | null;
  rounds: number | null;
  distance_km: number | null;
  duration_sec: number | null;
  heart_rate: number | null;
  pace: string | null;
  comment: string | null;
  date: string;
};

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export function formatSetsReps(entry: HistoryEntry): string | null {
  const perSetList = entry.reps?.includes("/");
  if (perSetList) return entry.reps ?? null;
  if (entry.sets != null && entry.reps) return `${entry.sets}×${entry.reps}`;
  if (entry.sets != null) return `${entry.sets} подх.`;
  return entry.reps ?? null;
}

export function formatWeight(entry: HistoryEntry): string | null {
  if (entry.weight == null) return null;
  return entry.weight > 0 ? `${entry.weight} кг` : "вес тела";
}

export function formatDuration(entry: HistoryEntry): string | null {
  if (entry.duration_sec == null || entry.duration_sec <= 0) return null;
  const total = entry.duration_sec;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return m > 0 ? `${m} мин` : `${s} сек`;
}

export function formatMetrics(entry: HistoryEntry): string[] {
  const metrics: string[] = [];
  if (entry.rounds != null) metrics.push(entry.rounds === -1 ? "МАКС раундов" : `${entry.rounds} раунд.`);
  if (entry.distance_km != null && entry.distance_km > 0) metrics.push(`${entry.distance_km} км`);
  if (entry.duration_sec != null && entry.rounds == null && entry.duration_sec > 0) metrics.push(formatDuration(entry)!);
  if (entry.pace) metrics.push(`темп ${entry.pace}`);
  if (entry.heart_rate != null) metrics.push(`пульс ${entry.heart_rate}`);
  return metrics;
}

export function formatPlannedWeight(weight: string): string {
  return weight === "0" ? "вес тела" : `${weight} кг`;
}

export function formatPlannedChild(child: { name: string; sets?: string; reps?: string; weight?: string }, letter: string | null, index: number): string {
  const parts: string[] = [];
  if (child.sets && child.reps) parts.push(`${child.sets}×${child.reps}`);
  else if (child.sets) parts.push(`${child.sets} подх.`);
  else if (child.reps) parts.push(child.reps);
  if (child.weight) parts.push(formatPlannedWeight(child.weight));
  const prefix = letter ? `${letter}${index + 1}. ` : "";
  return `${prefix}${[child.name, parts.join(" · ")].filter(Boolean).join(" - ")}`;
}

export function formatDate(entry: HistoryEntry): string | null {
  if (!entry.date) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entry.date);
  if (!match) return entry.date;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return entry.date;
  return `${day} ${MONTHS_SHORT[month - 1]}`;
}
