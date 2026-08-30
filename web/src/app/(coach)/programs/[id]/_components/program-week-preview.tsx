"use client";

import { useState, useId, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getColumns,
  getCellValue,
  getBlockColor,
  getCompositeLetters,
  isCompositeExercise,
  type ParsedContent,
  type ParsedWeek,
  type ParsedExercise,
} from "@/lib/program-utils";

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

const EXERCISE_COLUMN = "Упражнение";

function typeBadge(type?: string): ReactNode | null {
  if (type === "superset") return <Badge variant="secondary" className="text-[10px] leading-none">СУПЕРСЕТ</Badge>;
  if (type === "circuit") return <Badge variant="secondary" className="text-[10px] leading-none">КРУГ</Badge>;
  if (type === "cardio") return <Badge variant="secondary" className="text-[10px] leading-none">КАРДИО</Badge>;
  return null;
}

function getBlockAccent(block: string | undefined): string {
  const color = getBlockColor(block);
  if (color.includes("blue")) return "border-l-sky-400";
  if (color.includes("green")) return "border-l-emerald-400";
  if (color.includes("yellow")) return "border-l-amber-400";
  if (color.includes("primary")) return "border-l-primary";
  return "border-l-border";
}

const NUMERIC_COLS = new Set(["Подходы", "Повторы", "Вес", "Вес/% 1ПМ", "RPE", "Отдых", "Дистанция", "Время", "Темп", "Пульс", "Раунды"]);

function ExerciseCards({ exercise, letter, isChild = false }: { exercise: ParsedExercise; letter?: string; isChild?: boolean }) {
  const isComposite = isCompositeExercise(exercise);
  const detail = [exercise.sets && exercise.reps ? `${exercise.sets}×${exercise.reps}` : exercise.sets ?? exercise.reps, exercise.weight ? (exercise.weight === "0" ? "вес тела" : exercise.weight) : null, exercise.rpe ? `RPE ${exercise.rpe}` : null].filter(Boolean).join(" · ");
  const cardioMetrics = [exercise.distance ? `Дистанция: ${exercise.distance}` : null, exercise.duration ? `Время: ${exercise.duration}` : null, exercise.pace ? `Темп: ${exercise.pace}` : null, exercise.heart_rate ? `Пульс: ${exercise.heart_rate}` : null, exercise.rounds ? `Раунды: ${exercise.rounds}` : null].filter(Boolean);

  if (isComposite && exercise.children?.length) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-muted text-xs font-bold">{letter ?? "A"}</span>
          <span className="text-sm font-semibold">{exercise.name}</span>
          {typeBadge(exercise.type)}
        </div>
        <div className="space-y-2 pl-3">
          {exercise.children.map((child, ci) => (
            <ExerciseCards key={ci} exercise={child} letter={`${letter ?? "A"}${ci + 1}`} isChild />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border bg-card p-3 ${isChild ? "border-l-4 " + getBlockAccent(exercise.block) : ""} ${!isChild ? "border-l-4 " + getBlockAccent(exercise.block) : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {letter && <span className="text-xs font-bold text-primary">{letter}</span>}
          {typeBadge(exercise.type)}
          <span className="text-sm font-medium leading-tight">{exercise.name}</span>
        </div>
        {exercise.block && <Badge variant="outline" className="shrink-0 text-[10px] font-normal">{exercise.block}</Badge>}
      </div>
      {detail && <div className="mt-1.5 text-sm text-foreground/80">{detail}</div>}
      {cardioMetrics.length > 0 && <div className="mt-1 text-xs text-muted-foreground">{cardioMetrics.join(" · ")}</div>}
      {(exercise.rest || exercise.notes) && (
        <div className="mt-1.5 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {exercise.rest && <span>Отдых {exercise.rest}</span>}
          {exercise.notes && <span className="italic">— {exercise.notes}</span>}
        </div>
      )}
    </div>
  );
}

function ExerciseRows({ exercise, columns, letter, isChild = false }: { exercise: ParsedExercise; columns: string[]; letter?: string; isChild?: boolean }) {
  const isComposite = isCompositeExercise(exercise);
  const isCircuit = exercise.type === "circuit";
  const hideRest = isChild;
  const nameCell = (
    <span className="inline-flex flex-wrap items-center gap-1">
      {letter && <span className="mr-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-muted px-1 text-[11px] font-bold leading-none">{letter}</span>}
      {typeBadge(exercise.type)}
      <span className="leading-tight">{exercise.name}</span>
    </span>
  );
  const cardioMetrics = [
    exercise.distance ? `Дистанция: ${exercise.distance}` : null,
    !isCircuit && exercise.duration ? `Время: ${exercise.duration}` : null,
    exercise.pace ? `Темп: ${exercise.pace}` : null,
    exercise.heart_rate ? `Пульс: ${exercise.heart_rate}` : null,
    exercise.rounds ? `Раунды: ${exercise.rounds}` : null,
  ].filter(Boolean);

  if (isComposite && exercise.children?.length) {
    return (
      <>
        <TableRow className={`${getBlockColor(exercise.block)} border-l-4 ${getBlockAccent(exercise.block)}`}>
          <TableCell colSpan={columns.length}>
            <span className="inline-flex items-center gap-2">
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-muted px-1 text-[11px] font-bold">{letter ?? "A"}</span>
              <span className="font-semibold">{exercise.name}</span>
              {typeBadge(exercise.type)}
              {exercise.block && <span className="text-xs text-muted-foreground">— {exercise.block}</span>}
            </span>
          </TableCell>
        </TableRow>
        {exercise.children!.map((child, ci) => (
          <ExerciseRows key={ci} exercise={child} columns={columns} letter={`${letter ?? "A"}${ci + 1}`} isChild />
        ))}
      </>
    );
  }

  return (
    <>
      <TableRow className={`${getBlockColor(exercise.block)} ${isChild ? `border-l-4 ${getBlockAccent(exercise.block)}` : ""}`}>
        {columns.map((col) => (
          <TableCell
            key={col}
            className={
              col === EXERCISE_COLUMN
                ? "min-w-[220px] max-w-[320px] whitespace-normal break-words"
                : NUMERIC_COLS.has(col)
                  ? "whitespace-nowrap text-center text-sm tabular-nums"
                  : col === "Блок"
                    ? "whitespace-nowrap text-xs"
                    : col === "Заметки"
                      ? "max-w-[180px] whitespace-normal break-words text-xs text-muted-foreground"
                      : "whitespace-nowrap text-sm"
            }
          >
            {col === EXERCISE_COLUMN
              ? nameCell
              : hideRest && col === "Отдых"
                ? <span className="text-muted-foreground/40">—</span>
                : isCircuit && col === "Время"
                  ? <span className="text-muted-foreground/40">—</span>
                  : (() => { const v = getCellValue(exercise, col); return v === "—" ? <span className="text-muted-foreground/40">—</span> : v; })()}
          </TableCell>
        ))}
      </TableRow>
      {cardioMetrics.length > 0 && (
        <TableRow className="bg-muted/30">
          <TableCell colSpan={columns.length} className="py-1.5 text-xs text-muted-foreground">
            {cardioMetrics.join(" · ")}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function WeekItem({ week, columns, defaultOpen }: { week: ParsedWeek; columns: string[]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const panelId = `${id}-panel-${week.week_number}`;
  const days = week.days ?? [];

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <h3 className="m-0">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/50"
          aria-expanded={open}
          aria-controls={panelId}
        >
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-semibold">Неделя {week.week_number}</span>
            {week.week_label && <span className="truncate text-sm text-muted-foreground">— {week.week_label}</span>}
            {week.is_deload && <Badge variant="secondary" className="shrink-0">РАЗГРУЗКА</Badge>}
          </span>
          <ChevronDown open={open} />
        </button>
      </h3>

      {open && (
        <div id={panelId} className="space-y-6 border-t bg-muted/20 px-3 py-4 sm:px-4" role="region">
          {days.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет данных для этой недели</p>
          ) : (
            days.map((day, dayIdx) => {
              const dayKey = day.day_order ?? dayIdx;
              const exercises = day.exercises ?? [];
              const letters = getCompositeLetters(exercises);
              return (
                <div key={dayKey}>
                  <h4 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <span className="inline-flex h-6 items-center rounded-md bg-primary px-2.5 text-xs font-bold text-primary-foreground">{day.day_name}</span>
                    {day.focus && <span className="text-muted-foreground font-normal">— {day.focus}</span>}
                    <span className="text-xs font-normal text-muted-foreground">{exercises.length} упр.</span>
                  </h4>
                  {exercises.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Нет упражнений</p>
                  ) : (
                    <>
                      <div className="hidden md:block overflow-hidden rounded-lg border bg-card">
                        <Table className="table-fixed">
                          <TableHeader className="sticky top-0 z-[1] bg-muted/80 backdrop-blur">
                            <TableRow className="hover:bg-muted/80">
                              {columns.map((col) => (
                                <TableHead
                                  key={col}
                                  className={
                                    col === EXERCISE_COLUMN
                                      ? "w-[280px] whitespace-normal"
                                      : col === "Блок"
                                        ? "w-[130px]"
                                        : col === "Заметки"
                                          ? "w-[160px] whitespace-normal"
                                          : "w-[84px] whitespace-nowrap text-center"
                                  }
                                >
                                  {col}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {exercises.map((ex, i) => (
                              <ExerciseRows key={i} exercise={ex} columns={columns} letter={isCompositeExercise(ex) ? letters.get(i) : undefined} />
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      <div className="grid gap-2.5 md:hidden">
                        {exercises.map((ex, i) => (
                          <ExerciseCards key={i} exercise={ex} letter={isCompositeExercise(ex) ? letters.get(i) : undefined} />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export function ProgramWeekPreview({ parsed }: { parsed: ParsedContent | null }) {
  if (!parsed) return null;
  const weeks = parsed.weeks ?? [];
  const columns = getColumns(parsed);
  if (weeks.length === 0) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold">Содержание программы</h2>
        <p className="text-sm text-muted-foreground">Нет данных о неделях.</p>
      </div>
    );
  }
  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Содержание программы</h2>
      {parsed.notes && parsed.notes.length > 0 && (
        <div className="mb-4 rounded-xl border bg-amber-50/50 p-3 dark:bg-amber-950/10">
          <h3 className="mb-1 text-sm font-medium">Примечания</h3>
          <ul className="list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
            {parsed.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-3">
        {weeks.map((week, i) => (
          <WeekItem key={week.week_number ?? i} week={week} columns={columns} defaultOpen={i === 0} />
        ))}
      </div>
    </div>
  );
}
