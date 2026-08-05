"use client";

import type { HistoryDay, HistoryEntry } from "./page";

function formatSetsReps(entry: HistoryEntry): string | null {
  const perSetList = entry.reps?.includes("/");
  if (perSetList) return entry.reps ?? null;
  if (entry.sets != null && entry.reps) return `${entry.sets}×${entry.reps}`;
  if (entry.sets != null) return `${entry.sets} подх.`;
  return entry.reps ?? null;
}

function formatWeight(entry: HistoryEntry): string | null {
  if (entry.weight == null) return null;
  return entry.weight > 0 ? `${entry.weight} кг` : "вес тела";
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

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function formatDate(entry: HistoryEntry): string | null {
  if (!entry.date) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entry.date);
  if (!match) return entry.date;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return entry.date;
  return `${day} ${MONTHS_SHORT[month - 1]}`;
}

function EntryLine({ entry }: { entry: HistoryEntry }) {
  const weight = formatWeight(entry);
  const setsReps = formatSetsReps(entry);
  const date = formatDate(entry);
  return (
    <div className="flex flex-col gap-0.5">
      {date && (
        <div className="text-[11px] text-muted-foreground">{date}</div>
      )}
      <div className="font-medium">
        {[weight, setsReps].filter(Boolean).join(" ") || "—"}
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
