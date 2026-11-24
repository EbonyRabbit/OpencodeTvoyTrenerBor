import { Badge } from "@/components/ui/badge";
import {
  formatDate,
  formatMetrics,
  formatSetsReps,
  formatWeight,
  type HistoryEntry,
} from "@/lib/history-format";
import { formatPeriodLabel, type HistoryPeriodOption } from "@/lib/history-periods";

export type HistoryAllLog = HistoryEntry & {
  program_period_id: string | null;
  created_at: string | null;
};

function isSkipLog(log: HistoryAllLog): boolean {
  return log.exercise.trim().toLowerCase().startsWith("[skip]");
}

function isPseudoLog(log: HistoryAllLog): boolean {
  return log.exercise.trim().startsWith("[");
}

function EntryLine({ entry }: { entry: HistoryAllLog }) {
  const metrics = formatMetrics(entry);
  const weight = metrics.length > 0 ? null : formatWeight(entry);
  const setsReps = metrics.length > 0 ? null : formatSetsReps(entry);
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium leading-tight">{entry.exercise}</div>
      {metrics.length > 0 || weight || setsReps ? (
        <div className="text-sm leading-tight">
          {metrics.length > 0 ? metrics.join(" · ") : [weight, setsReps].filter(Boolean).join(" ")}
        </div>
      ) : null}
      {entry.rpe != null ? (
        <div className="text-xs text-muted-foreground">RPE {entry.rpe}</div>
      ) : null}
      {entry.comment?.trim() ? (
        <div className="text-xs text-muted-foreground">{entry.comment.trim()}</div>
      ) : null}
    </div>
  );
}

export function HistoryAllList({
  logs,
  periods,
  truncated = false,
}: {
  logs: HistoryAllLog[];
  periods: HistoryPeriodOption[];
  truncated?: boolean;
}) {
  const labels = new Map(periods.map((period) => [period.id, formatPeriodLabel(period)]));
  const visible = logs
    .filter((log) => !isPseudoLog(log) || isSkipLog(log))
    .slice()
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    });

  const truncationBanner = truncated ? (
    <div className="rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      Показаны последние 2000 тренировок
    </div>
  ) : null;

  if (visible.length === 0) {
    return (
      <div className="space-y-4">
        {truncationBanner}
        <div className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          История тренировок пока пустая
        </div>
      </div>
    );
  }

  const groups = new Map<string, HistoryAllLog[]>();
  for (const log of visible) {
    const group = groups.get(log.date) ?? [];
    group.push(log);
    groups.set(log.date, group);
  }

  return (
    <div className="space-y-4">
      {truncationBanner}
      {[...groups.entries()].map(([date, entries]) => (
        <div key={date} className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">{formatDate({ ...entries[0], date })}</div>
            <Badge variant="outline">{entries.length}</Badge>
          </div>
          <div className="divide-y">
            {entries.map((log, index) => (
              <div key={`${log.exercise}-${index}`} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {isSkipLog(log) ? (
                    <div className="text-sm text-muted-foreground">
                      Пропуск{log.comment?.trim() ? `: ${log.comment.trim()}` : ""}
                    </div>
                  ) : (
                    <EntryLine entry={log} />
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    {labels.get(log.program_period_id ?? "") ?? "Без периода"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
