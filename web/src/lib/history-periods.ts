export type HistoryPeriodOption = {
  id: string;
  programId: string | null;
  programTitle: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
};

export type HistorySelection =
  | { mode: "all"; periodId: null }
  | { mode: "period"; periodId: string | null };

export function resolveHistorySelection(
  raw: string | string[] | undefined,
  periods: HistoryPeriodOption[],
  activePeriodId: string | null,
): HistorySelection {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === "all") return { mode: "all", periodId: null };
  if (value && periods.some((period) => period.id === value)) {
    return { mode: "period", periodId: value };
  }
  const active = periods.find((period) => period.id === activePeriodId);
  return {
    mode: "period",
    periodId: active?.id ?? periods[0]?.id ?? null,
  };
}

export function formatPeriodLabel(period: HistoryPeriodOption): string {
  const date = new Date(period.startedAt);
  const suffix = Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
  const title = period.programTitle || "Без программы";
  const state = period.status === "active" ? "сейчас" : "завершён";
  return [title, suffix, state].filter(Boolean).join(" · ");
}
