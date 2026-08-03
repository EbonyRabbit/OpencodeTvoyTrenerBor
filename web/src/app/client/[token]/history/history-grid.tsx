"use client";

import type { HistoryRow } from "./page";

function formatLog(log: { exercise: string; weight: number | null; sets: number | null; reps: string | null }): string {
  const weight =
    log.weight != null && log.weight > 0 ? `${log.weight} кг` : log.weight === 0 ? "вес тела" : null;
  const perSetList = log.reps && log.reps.includes("/");
  const setsReps = perSetList
    ? log.reps
    : log.sets != null && log.reps
      ? `${log.sets}×${log.reps}`
      : log.sets != null
        ? `${log.sets} подх.`
        : log.reps
          ? log.reps
          : null;
  const detail = [weight, setsReps].filter(Boolean).join(" ");
  return detail ? `${log.exercise} — ${detail}` : log.exercise;
}

export function HistoryGrid({
  rows,
  weekCount,
  currentWeek,
}: {
  rows: HistoryRow[];
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
          {rows.map((row) => (
            <tr key={row.day_order}>
              <td className="sticky left-0 z-10 border-b border-r bg-background px-3 py-2 align-top">
                <div className="font-medium">{row.day_name}</div>
                {row.focus && (
                  <div className="text-xs text-muted-foreground">{row.focus}</div>
                )}
              </td>
              {row.cells.map((cell, i) => {
                const isCurrent = i + 1 === currentWeek;
                if (!cell || cell.logs.length === 0) {
                  return (
                    <td
                      key={i}
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
                    key={i}
                    className={`border-b border-r px-2 py-2 align-top ${
                      isCurrent ? "bg-primary/5" : ""
                    }`}
                  >
                    <ul className="space-y-0.5">
                      {cell.logs.map((log, j) => (
                        <li key={j} className="leading-tight">
                          {formatLog(log)}
                        </li>
                      ))}
                    </ul>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
