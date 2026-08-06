"use client";

import { useState, useId, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
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
      className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
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
  if (type === "superset") return <Badge variant="secondary" className="mr-1.5 text-[10px]">СУПЕРСЕТ</Badge>;
  if (type === "circuit") return <Badge variant="secondary" className="mr-1.5 text-[10px]">КРУГ</Badge>;
  if (type === "cardio") return <Badge variant="secondary" className="mr-1.5 text-[10px]">КАРДИО</Badge>;
  return null;
}

function ExerciseRows({ exercise, columns, letter }: { exercise: ParsedExercise; columns: string[]; letter?: string }) {
  const type = exercise.type ?? "strength";
  const isComposite = isCompositeExercise(exercise);
  const nameCell = (
    <>
      {letter && (
        <span className="mr-1 text-xs font-semibold text-muted-foreground">{letter}</span>
      )}
      {typeBadge(exercise.type)}
      {exercise.name}
    </>
  );
  const cardioMetrics = [
    exercise.distance ? `Дистанция: ${exercise.distance}` : null,
    exercise.duration ? `Время: ${exercise.duration}` : null,
    exercise.pace ? `Темп: ${exercise.pace}` : null,
    exercise.heart_rate ? `Пульс: ${exercise.heart_rate}` : null,
    exercise.rounds ? `Раунды: ${exercise.rounds}` : null,
  ].filter(Boolean);

  return (
    <>
      <TableRow className={getBlockColor(exercise.block)}>
        {columns.map((col) => (
          <TableCell key={col}>
            {col === EXERCISE_COLUMN ? nameCell : getCellValue(exercise, col)}
          </TableCell>
        ))}
      </TableRow>
      {cardioMetrics.length > 0 && (
        <TableRow>
          <TableCell colSpan={columns.length} className="text-xs text-muted-foreground">
            {cardioMetrics.join(" · ")}
          </TableCell>
        </TableRow>
      )}
      {isComposite && (exercise.children?.length ?? 0) > 0 && (
        <TableRow>
          <TableCell colSpan={columns.length} className="p-0">
            <div className="ml-6 border-l border-muted pl-3">
              <Table>
                <TableBody>
                  {exercise.children!.map((child, ci) => (
                    <ExerciseRows
                      key={ci}
                      exercise={child}
                      columns={columns}
                      letter={`${letter ?? "A"}${ci + 1}`}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function WeekItem({
  week,
  columns,
  defaultOpen,
}: {
  week: ParsedWeek;
  columns: string[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const panelId = `${id}-panel-${week.week_number}`;
  const days = week.days ?? [];

  return (
    <div className="rounded-lg border">
      <h3 className="m-0">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
          aria-expanded={open}
          aria-controls={panelId}
        >
          <span className="flex items-center gap-3">
            <span className="font-medium">Неделя {week.week_number}</span>
            {week.week_label && (
              <span className="text-sm text-muted-foreground">
                — {week.week_label}
              </span>
            )}
            {week.is_deload && (
              <Badge variant="secondary">РАЗГРУЗКА</Badge>
            )}
          </span>
          <ChevronDown open={open} />
        </button>
      </h3>

      {open && (
        <div id={panelId} className="border-t px-4 py-3 space-y-4" role="region">
          {days.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Нет данных для этой недели
            </p>
          ) : (
            days.map((day, dayIdx) => {
              const dayKey = day.day_order ?? dayIdx;
              const exercises = day.exercises ?? [];
              const letters = getCompositeLetters(exercises);
              return (
                <div key={dayKey}>
                  <h4 className="mb-2 text-sm font-medium">
                    {day.day_name}
                    {day.focus && (
                      <span className="ml-2 text-muted-foreground">
                        — {day.focus}
                      </span>
                    )}
                  </h4>
                  {exercises.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Нет упражнений
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {columns.map((col) => (
                              <TableHead key={col}>{col}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {exercises.map((ex, i) => (
                            <ExerciseRows
                              key={i}
                              exercise={ex}
                              columns={columns}
                              letter={isCompositeExercise(ex) ? letters.get(i) : undefined}
                            />
                          ))}
                        </TableBody>
                      </Table>
                    </div>
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

export function ProgramWeekPreview({
  parsed,
}: {
  parsed: ParsedContent | null;
}) {
  if (!parsed) {
    return null;
  }

  const weeks = parsed.weeks ?? [];
  const columns = getColumns(parsed);

  if (weeks.length === 0) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold">Содержание программы</h2>
        <p className="text-sm text-muted-foreground">
          Нет данных о неделях.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Содержание программы</h2>

      {parsed.notes && parsed.notes.length > 0 && (
        <div className="mb-4 rounded-lg border bg-muted/50 p-3">
          <h3 className="mb-1 text-sm font-medium">Примечания</h3>
          <ul className="list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
            {parsed.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        {weeks.map((week, i) => (
          <WeekItem
            key={week.week_number ?? i}
            week={week}
            columns={columns}
            defaultOpen={i === 0}
          />
        ))}
      </div>
    </div>
  );
}
