"use client";

import type { HistoryDay } from "./page";
import type { HistoryEntry } from "@/lib/history-format";
import {
  formatDate,
  formatMetrics,
  formatPlannedChild,
  formatSetsReps,
  formatWeight,
} from "@/lib/history-format";

export function HistoryGrid({
  days,
  weekCount,
  currentWeek,
}: {
  days: HistoryDay[];
  weekCount: number;
  currentWeek: number | null;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[700px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 border-b border-r bg-muted px-3 py-2 text-left font-medium">
              День
            </th>
            {Array.from({ length: weekCount }, (_, i) => {
              const week = i + 1;
              const isCurrent = week === currentWeek;
              return (
                <th
                  key={week}
                  className={`border-b border-r px-2 py-2 text-center font-medium ${
                    isCurrent ? "bg-primary/10 text-primary" : "bg-muted"
                  }`}
                >
                  Неделя {week}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <DayGroup key={day.day_order} day={day} weekCount={weekCount} currentWeek={currentWeek} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayGroup({
  day,
  weekCount,
  currentWeek,
}: {
  day: HistoryDay;
  weekCount: number;
  currentWeek: number | null;
}) {
  return (
    <>
      <tr>
        <td className="sticky left-0 z-10 border-b border-r bg-background px-3 py-2 align-top">
          <div className="font-medium">День {day.day_order}</div>
          {day.focus && (
            <div className="text-xs text-muted-foreground">{day.focus}</div>
          )}
        </td>
        {day.skips.map((reason, i) => {
          const week = i + 1;
          const isCurrent = week === currentWeek;
          if (!reason) {
            return (
              <td
                key={week}
                className={`border-b border-r px-2 py-2 text-center ${
                  isCurrent ? "bg-primary/5" : ""
                }`}
              >
                <span className="text-muted-foreground/40">—</span>
              </td>
            );
          }
          return (
            <td
              key={week}
              className={`border-b border-r px-2 py-2 text-center align-middle ${
                isCurrent ? "bg-primary/5" : ""
              }`}
            >
              <span
                className="inline-block rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground"
                title={reason}
              >
                ⏭ пропуск
              </span>
            </td>
          );
        })}
      </tr>
      {day.rows.map((row) => (
        <tr key={row.day_order + ":" + row.exercise}>
          <td className="sticky left-0 z-10 border-b border-r bg-background px-3 py-2 align-top font-medium">
            {row.exercise}
            {row.children.length > 0 && (
              <div className="mt-0.5 space-y-0.5 font-normal">
                {row.children.map((child, ci) => (
                  <div key={ci} className="text-xs text-muted-foreground">
                    {formatPlannedChild(child, row.compositeLetter, ci)}
                  </div>
                ))}
              </div>
            )}
          </td>
          {row.cells.map((cell, i) => {
            const week = i + 1;
            const isCurrent = week === currentWeek;
            if (!cell || cell.entries.length === 0) {
              return (
                <td
                  key={week}
                  className={`border-b border-r px-2 py-2 text-center text-muted-foreground ${
                    isCurrent ? "bg-primary/5" : ""
                  }`}
                >
                  —
                </td>
              );
            }
            return (
              <td
                key={week}
                className={`border-b border-r px-2 py-2 align-top ${
                  isCurrent ? "bg-primary/5" : ""
                }`}
              >
                <ul className="space-y-1">
                  {cell.entries.map((entry, j) => (
                    <li key={j} className="leading-tight">
                      <EntryLine entry={entry} />
                    </li>
                  ))}
                </ul>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

function EntryLine({ entry }: { entry: HistoryEntry }) {
  const metrics = formatMetrics(entry);
  const weight = metrics.length > 0 ? null : formatWeight(entry);
  const setsReps = metrics.length > 0 ? null : formatSetsReps(entry);
  const date = formatDate(entry);
  return (
    <div className="flex flex-col gap-0.5">
      {date && (
        <div className="text-[11px] text-muted-foreground">{date}</div>
      )}
      <div className="font-medium">
        {metrics.length > 0 ? metrics.join(" · ") : [weight, setsReps].filter(Boolean).join(" ") || "—"}
      </div>
      {entry.rpe != null && (
        <div className="text-xs text-muted-foreground">RPE {entry.rpe}</div>
      )}
      {entry.comment?.trim() && (
        <div className="text-xs text-muted-foreground">{entry.comment.trim()}</div>
      )}
    </div>
  );
}
