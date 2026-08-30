"use client";

import { useState } from "react";
import type { HistoryDay } from "./page";
import type { HistoryEntry } from "@/lib/history-format";
import {
  formatDate,
  formatMetrics,
  formatPlannedChild,
  formatSetsReps,
  formatWeight,
} from "@/lib/history-format";
import { Badge } from "@/components/ui/badge";

function WeekBadge({ week, isCurrent }: { week: number; isCurrent: boolean }) {
  return (
    <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 text-xs font-bold ${isCurrent ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
      {week}
    </span>
  );
}

export function HistoryGrid({
  days,
  weekCount,
  currentWeek,
}: {
  days: HistoryDay[];
  weekCount: number;
  currentWeek: number | null;
}) {
  const [mode, setMode] = useState<"table" | "ribbon">("ribbon");
  return (
    <div className="space-y-3">
      <div className="flex justify-end md:hidden">
        <div className="inline-flex rounded-lg border p-0.5 text-xs">
          <button onClick={() => setMode("ribbon")} className={`rounded-md px-3 py-1 font-medium transition-colors ${mode === "ribbon" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Лента</button>
          <button onClick={() => setMode("table")} className={`rounded-md px-3 py-1 font-medium transition-colors ${mode === "table" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Таблица</button>
        </div>
      </div>

      <div className={`${mode === "ribbon" ? "hidden md:block" : "block"} overflow-x-auto rounded-xl border bg-card`}>
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="sticky left-0 z-20 border-b border-r bg-card px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground shadow-sm">День</th>
              {Array.from({ length: weekCount }, (_, i) => {
                const week = i + 1;
                const isCurrent = week === currentWeek;
                return (
                  <th key={week} className={`border-b border-r px-2 py-2.5 text-center text-xs font-semibold ${isCurrent ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground"}`}>
                    <span className="inline-flex items-center gap-1">{isCurrent && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground animate-pulse" />}Н{week}</span>
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

      <div className={`${mode === "ribbon" ? "block md:hidden" : "hidden"} space-y-4`}>
        {Array.from({ length: weekCount }, (_, wi) => {
          const week = wi + 1;
          const isCurrent = week === currentWeek;
          return (
            <div key={week} className={`overflow-hidden rounded-xl border ${isCurrent ? "border-primary/40 ring-1 ring-primary/20" : "bg-card"}`}>
              <div className={`flex items-center justify-between px-3 py-2 ${isCurrent ? "bg-primary text-primary-foreground" : "bg-muted/50"}`}>
                <span className="text-sm font-bold">Неделя {week}</span>
                {isCurrent && <Badge variant="secondary" className="bg-white text-primary text-[10px]">СЕЙЧАС</Badge>}
              </div>
              <div className="divide-y">
                {days.map((day) => {
                  const skip = day.skips[wi];
                  const hasRows = day.rows.length > 0;
                  if (!hasRows && !skip) return null;
                  return (
                    <div key={day.day_order} className="px-3 py-3">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="text-sm font-semibold">День {day.day_order}</span>
                        {day.focus && <span className="text-xs text-muted-foreground">— {day.focus}</span>}
                      </div>
                      {skip ? (
                        <div className="rounded-lg border border-dashed bg-amber-50/50 px-3 py-2 text-xs text-muted-foreground dark:bg-amber-950/10">⏭ Пропуск{typeof skip === "string" && skip !== "без причины" ? `: ${skip}` : ""}</div>
                      ) : (
                        <div className="space-y-2">
                          {day.rows.map((row) => {
                            const cell = row.cells[wi];
                            const empty = !cell || cell.entries.length === 0;
                            return (
                              <div key={row.exercise} className={`rounded-lg border px-3 py-2 ${empty ? "bg-muted/30 border-dashed" : "bg-card"}`}>
                                <div className="text-sm font-medium leading-tight">{row.exercise}</div>
                                {row.children.length > 0 && (
                                  <div className="mt-1 space-y-0.5">
                                    {row.children.map((child, ci) => (
                                      <div key={ci} className="text-xs text-muted-foreground">{formatPlannedChild(child, row.compositeLetter, ci)}</div>
                                    ))}
                                  </div>
                                )}
                                <div className="mt-1.5">
                                  {empty ? (
                                    <span className="text-xs text-muted-foreground/50">— нет данных</span>
                                  ) : (
                                    <ul className="space-y-1">
                                      {cell.entries.map((entry, j) => (
                                        <li key={j}><EntryLine entry={entry} compact /></li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayGroup({ day, weekCount, currentWeek }: { day: HistoryDay; weekCount: number; currentWeek: number | null }) {
  return (
    <>
      <tr className="bg-muted/20">
        <td className="sticky left-0 z-10 border-b border-r bg-card px-3 py-2.5 align-middle shadow-sm">
          <div className="text-sm font-semibold leading-tight">День {day.day_order}</div>
          {day.focus && <div className="text-xs leading-tight text-muted-foreground">{day.focus}</div>}
        </td>
        {day.skips.map((reason, i) => {
          const week = i + 1;
          const isCurrent = week === currentWeek;
          if (!reason) {
            return (
              <td key={week} className={`border-b border-r px-2 py-2 text-center ${isCurrent ? "bg-primary/[0.04]" : ""}`}>
                <span className="text-muted-foreground/30">—</span>
              </td>
            );
          }
          return (
            <td key={week} className={`border-b border-r px-2 py-2 text-center align-middle ${isCurrent ? "bg-primary/[0.04]" : ""}`}>
              <span className="inline-flex items-center rounded-full border border-dashed bg-amber-50 px-2 py-0.5 text-xs text-muted-foreground dark:bg-amber-950/20" title={String(reason)}>⏭ пропуск</span>
            </td>
          );
        })}
      </tr>
      {day.rows.map((row) => (
        <tr key={row.day_order + ":" + row.exercise} className="hover:bg-muted/20">
          <td className="sticky left-0 z-10 border-b border-r bg-card px-3 py-2.5 align-top shadow-sm">
            <div className="text-sm font-medium leading-tight">{row.exercise}</div>
            {row.children.length > 0 && (
              <div className="mt-1 space-y-0.5">
                {row.children.map((child, ci) => (
                  <div key={ci} className="text-xs leading-tight text-muted-foreground">{formatPlannedChild(child, row.compositeLetter, ci)}</div>
                ))}
              </div>
            )}
          </td>
          {row.cells.map((cell, i) => {
            const week = i + 1;
            const isCurrent = week === currentWeek;
            if (!cell || cell.entries.length === 0) {
              return (
                <td key={week} className={`border-b border-r px-2 py-2 text-center align-middle ${isCurrent ? "bg-primary/[0.04]" : ""}`}>
                  <span className="text-muted-foreground/30">—</span>
                </td>
              );
            }
            return (
              <td key={week} className={`border-b border-r px-2 py-2 align-top ${isCurrent ? "bg-emerald-50/40 dark:bg-emerald-950/10" : ""}`}>
                <ul className="space-y-1.5">
                  {cell.entries.map((entry, j) => (
                    <li key={j} className="leading-tight"><EntryLine entry={entry} /></li>
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

function EntryLine({ entry, compact = false }: { entry: HistoryEntry; compact?: boolean }) {
  const metrics = formatMetrics(entry);
  const weight = metrics.length > 0 ? null : formatWeight(entry);
  const setsReps = metrics.length > 0 ? null : formatSetsReps(entry);
  const date = formatDate(entry);
  return (
    <div className={`flex flex-col ${compact ? "gap-0.5" : "gap-0.5"}`}>
      {date && <div className="text-[11px] leading-none text-muted-foreground">{date}</div>}
      <div className="text-sm font-medium leading-tight">{metrics.length > 0 ? metrics.join(" · ") : [weight, setsReps].filter(Boolean).join(" ") || "—"}</div>
      {entry.rpe != null && <div className="text-xs leading-none text-muted-foreground">RPE {entry.rpe}</div>}
      {entry.comment?.trim() && <div className="line-clamp-2 text-xs leading-tight text-muted-foreground">{entry.comment.trim()}</div>}
    </div>
  );
}
