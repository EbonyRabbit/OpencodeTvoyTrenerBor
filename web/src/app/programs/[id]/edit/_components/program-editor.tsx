"use client";

import { useState, useReducer, useCallback, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionTrigger,
  AccordionPanel,
} from "@/components/ui/accordion";
import { type ProgramRow } from "@/lib/program-utils";
import {
  type EditableParsedContent,
  type EditableWeek,
  type EditableDay,
  type EditableExercise,
} from "@/lib/program-editor-types";
import { updateProgramContent } from "../../actions";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { ExerciseAutocomplete } from "./exercise-autocomplete";

type EditorAction =
  | { type: "SET_CONTENT"; payload: EditableParsedContent }
  | { type: "ADD_WEEK" }
  | { type: "DELETE_WEEK"; weekIndex: number }
  | { type: "UPDATE_WEEK"; weekIndex: number; payload: Partial<EditableWeek> }
  | { type: "ADD_DAY"; weekIndex: number }
  | { type: "DELETE_DAY"; weekIndex: number; dayIndex: number }
  | { type: "UPDATE_DAY"; weekIndex: number; dayIndex: number; payload: Partial<EditableDay> }
  | { type: "ADD_EXERCISE"; weekIndex: number; dayIndex: number }
  | { type: "DELETE_EXERCISE"; weekIndex: number; dayIndex: number; exerciseIndex: number }
  | { type: "UPDATE_EXERCISE"; weekIndex: number; dayIndex: number; exerciseIndex: number; payload: Partial<EditableExercise> };

function editorReducer(state: EditableParsedContent, action: EditorAction): EditableParsedContent {
  switch (action.type) {
    case "SET_CONTENT":
      return action.payload;

    case "ADD_WEEK": {
      const weeks = state.weeks ?? [];
      const nextNumber = weeks.length > 0 ? Math.max(...weeks.map((w) => w.week_number)) + 1 : 1;
      return {
        ...state,
        weeks: [
          ...weeks,
          {
            week_number: nextNumber,
            week_label: `Неделя ${nextNumber}`,
            days: [],
          },
        ],
      };
    }

    case "DELETE_WEEK": {
      const weeks = (state.weeks ?? []).filter((_, i) => i !== action.weekIndex);
      return { ...state, weeks };
    }

    case "UPDATE_WEEK": {
      const weeks = (state.weeks ?? []).map((w, i) =>
        i === action.weekIndex ? { ...w, ...action.payload } : w
      );
      return { ...state, weeks };
    }

    case "ADD_DAY": {
      const weeks = (state.weeks ?? []).map((w, i) => {
        if (i !== action.weekIndex) return w;
        const days = w.days ?? [];
        const nextOrder = days.length > 0 ? Math.max(...days.map((d) => d.day_order)) + 1 : 1;
        return {
          ...w,
          days: [
            ...days,
            {
              day_name: `День ${nextOrder}`,
              day_order: nextOrder,
              exercises: [],
            },
          ],
        };
      });
      return { ...state, weeks };
    }

    case "DELETE_DAY": {
      const weeks = (state.weeks ?? []).map((w, i) => {
        if (i !== action.weekIndex) return w;
        return { ...w, days: (w.days ?? []).filter((_, j) => j !== action.dayIndex) };
      });
      return { ...state, weeks };
    }

    case "UPDATE_DAY": {
      const weeks = (state.weeks ?? []).map((w, i) => {
        if (i !== action.weekIndex) return w;
        const days = (w.days ?? []).map((d, j) =>
          j === action.dayIndex ? { ...d, ...action.payload } : d
        );
        return { ...w, days };
      });
      return { ...state, weeks };
    }

    case "ADD_EXERCISE": {
      const weeks = (state.weeks ?? []).map((w, i) => {
        if (i !== action.weekIndex) return w;
        const days = (w.days ?? []).map((d, j) => {
          if (j !== action.dayIndex) return d;
          return {
            ...d,
            exercises: [
              ...(d.exercises ?? []),
              { name: "", block: "", sets: "", reps: "", weight: "", rpe: "", rest: "", notes: "" },
            ],
          };
        });
        return { ...w, days };
      });
      return { ...state, weeks };
    }

    case "DELETE_EXERCISE": {
      const weeks = (state.weeks ?? []).map((w, i) => {
        if (i !== action.weekIndex) return w;
        const days = (w.days ?? []).map((d, j) => {
          if (j !== action.dayIndex) return d;
          return {
            ...d,
            exercises: (d.exercises ?? []).filter((_, k) => k !== action.exerciseIndex),
          };
        });
        return { ...w, days };
      });
      return { ...state, weeks };
    }

    case "UPDATE_EXERCISE": {
      const weeks = (state.weeks ?? []).map((w, i) => {
        if (i !== action.weekIndex) return w;
        const days = (w.days ?? []).map((d, j) => {
          if (j !== action.dayIndex) return d;
          const exercises = (d.exercises ?? []).map((e, k) =>
            k === action.exerciseIndex ? { ...e, ...action.payload } : e
          );
          return { ...d, exercises };
        });
        return { ...w, days };
      });
      return { ...state, weeks };
    }

    default:
      return state;
  }
}

function createEmptyContent(): EditableParsedContent {
  return {
    weeks: [
      {
        week_number: 1,
        week_label: "Неделя 1",
        days: [
          {
            day_name: "День 1",
            day_order: 1,
            exercises: [],
          },
        ],
      },
    ],
  };
}

function ExerciseRow({
  exercise,
  onUpdate,
  onDelete,
}: {
  exercise: EditableExercise;
  onUpdate: (payload: Partial<EditableExercise>) => void;
  onDelete: () => void;
}) {
  return (
    <tr className="border-b last:border-b-0">
      <td className="py-1 px-1">
        <ExerciseAutocomplete
          value={exercise.name}
          onChange={(val) => onUpdate({ name: val })}
          placeholder="Упражнение"
          className="h-8 text-xs"
        />
      </td>
      <td className="py-1 px-1">
        <Input
          value={exercise.block ?? ""}
          onChange={(e) => onUpdate({ block: e.target.value || undefined })}
          placeholder="Блок"
          className="h-8 text-xs"
        />
      </td>
      <td className="py-1 px-1">
        <Input
          value={exercise.sets ?? ""}
          onChange={(e) => onUpdate({ sets: e.target.value || undefined })}
          placeholder="Подходы"
          className="h-8 text-xs w-16"
        />
      </td>
      <td className="py-1 px-1">
        <Input
          value={exercise.reps ?? ""}
          onChange={(e) => onUpdate({ reps: e.target.value || undefined })}
          placeholder="Повторы"
          className="h-8 text-xs w-16"
        />
      </td>
      <td className="py-1 px-1">
        <Input
          value={exercise.weight ?? ""}
          onChange={(e) => onUpdate({ weight: e.target.value || undefined })}
          placeholder="Вес"
          className="h-8 text-xs w-16"
        />
      </td>
      <td className="py-1 px-1">
        <Input
          value={exercise.rpe ?? ""}
          onChange={(e) => onUpdate({ rpe: e.target.value || undefined })}
          placeholder="RPE"
          className="h-8 text-xs w-14"
        />
      </td>
      <td className="py-1 px-1">
        <Input
          value={exercise.rest ?? ""}
          onChange={(e) => onUpdate({ rest: e.target.value || undefined })}
          placeholder="Отдых"
          className="h-8 text-xs w-16"
        />
      </td>
      <td className="py-1 px-1">
        <Input
          value={exercise.notes ?? ""}
          onChange={(e) => onUpdate({ notes: e.target.value || undefined })}
          placeholder="Заметки"
          className="h-8 text-xs"
        />
      </td>
      <td className="py-1 px-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDelete}
          aria-label={`Удалить упражнение ${exercise.name || ""}`}
          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </td>
    </tr>
  );
}

function DaySection({
  day,
  weekIndex,
  dayIndex,
  dispatch,
}: {
  day: EditableDay;
  weekIndex: number;
  dayIndex: number;
  dispatch: React.Dispatch<EditorAction>;
}) {
  const exercises = day.exercises ?? [];

  return (
    <div className="mb-3 rounded-md border p-3">
      <div className="mb-2 flex items-center gap-2">
        <Input
          value={day.day_name}
          onChange={(e) =>
            dispatch({
              type: "UPDATE_DAY",
              weekIndex,
              dayIndex,
              payload: { day_name: e.target.value },
            })
          }
          className="h-7 w-40 text-xs font-medium"
        />
        <Input
          value={day.focus ?? ""}
          onChange={(e) =>
            dispatch({
              type: "UPDATE_DAY",
              weekIndex,
              dayIndex,
              payload: { focus: e.target.value.trim() || undefined },
            })
          }
          placeholder="Фокус (напр. Верх, Ноги)"
          className="h-7 w-52 text-xs"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            dispatch({ type: "DELETE_DAY", weekIndex, dayIndex })
          }
          className="h-7 px-2 text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3 w-3 mr-1" />
          Удалить день
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-1 px-1 font-medium">Упражнение</th>
              <th className="py-1 px-1 font-medium">Блок</th>
              <th className="py-1 px-1 font-medium">Подходы</th>
              <th className="py-1 px-1 font-medium">Повторы</th>
              <th className="py-1 px-1 font-medium">Вес</th>
              <th className="py-1 px-1 font-medium">RPE</th>
              <th className="py-1 px-1 font-medium">Отдых</th>
              <th className="py-1 px-1 font-medium">Заметки</th>
              <th className="py-1 px-1 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {exercises.map((ex, exIdx) => (
              <ExerciseRow
                key={exIdx}
                exercise={ex}
                onUpdate={(payload) =>
                  dispatch({
                    type: "UPDATE_EXERCISE",
                    weekIndex,
                    dayIndex,
                    exerciseIndex: exIdx,
                    payload,
                  })
                }
                onDelete={() =>
                  dispatch({
                    type: "DELETE_EXERCISE",
                    weekIndex,
                    dayIndex,
                    exerciseIndex: exIdx,
                  })
                }
              />
            ))}
          </tbody>
        </table>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() =>
          dispatch({ type: "ADD_EXERCISE", weekIndex, dayIndex })
        }
        className="mt-2 h-7 text-xs"
      >
        <Plus className="h-3 w-3 mr-1" />
        Добавить упражнение
      </Button>
    </div>
  );
}

export function ProgramEditor({
  program,
  parsedContent,
}: {
  program: ProgramRow;
  parsedContent: EditableParsedContent | null;
}) {
  const [state, dispatch] = useReducer(editorReducer, parsedContent, (arg) =>
    arg ?? createEmptyContent()
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [dirty, setDirty] = useState(false);

  const weeks = state.weeks ?? [];
  const [openPanels, setOpenPanels] = useState<string[]>(() => weeks.map((_, i) => `week-${i}`));

  useEffect(() => {
    setOpenPanels((prev) => {
      const next = weeks.map((_, i) => `week-${i}`);
      return prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next;
    });
  }, [weeks.length]);

  const handleSave = useCallback(async () => {
    const exercises = (state.weeks ?? []).flatMap((w) =>
      (w.days ?? []).flatMap((d) => d.exercises ?? [])
    );
    const emptyNames = exercises.filter((e) => !e.name.trim());
    if (emptyNames.length > 0) {
      setSaveError(`Заполните название у ${emptyNames.length} упражнени${emptyNames.length === 1 ? "я" : "й"}`);
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const result = await updateProgramContent(program.id, state);
      if (result.error) {
        setSaveError(result.error);
      } else {
        setSaveSuccess(true);
        setDirty(false);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch {
      setSaveError("Произошла ошибка при сохранении");
    } finally {
      setSaving(false);
    }
  }, [program.id, state]);

  const dispatchTracked = useCallback(
    (action: EditorAction) => {
      setDirty(true);
      dispatch(action);
    },
    []
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link
            href={`/programs/${program.id}`}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            ← Назад к программе
          </Link>
          <h1 className="mt-2 text-2xl font-bold">Редактирование: {program.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-xs text-muted-foreground">Есть несохранённые изменения</span>
          )}
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                Сохранение...
              </>
            ) : (
              "Сохранить"
            )}
          </Button>
        </div>
      </div>

      {saveError && (
        <Alert variant="destructive">
          <AlertTitle>Ошибка</AlertTitle>
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}

      {saveSuccess && (
        <Alert className="border-green-500 bg-green-50 text-green-800">
          <AlertDescription>Сохранено</AlertDescription>
        </Alert>
      )}

      <Accordion multiple value={openPanels} onValueChange={setOpenPanels}>
        {weeks.map((week, weekIdx) => (
          <AccordionItem key={weekIdx} value={`week-${weekIdx}`}>
            <AccordionHeader>
              <AccordionTrigger className="text-base">
                <span>
                  Неделя {week.week_number}
                  {week.week_label ? ` — ${week.week_label}` : ""}
                  {week.is_deload ? " (Deload)" : ""}
                </span>
              </AccordionTrigger>
            </AccordionHeader>
            <AccordionPanel>
              <div className="space-y-3 pb-2 pt-1">
                <div className="flex items-center gap-2">
                  <Input
                    value={week.week_label ?? ""}
                    onChange={(e) =>
                      dispatchTracked({
                        type: "UPDATE_WEEK",
                        weekIndex: weekIdx,
                        payload: { week_label: e.target.value },
                      })
                    }
                    placeholder="Название недели"
                    className="h-7 w-60 text-xs"
                  />
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={week.is_deload ?? false}
                      onChange={(e) =>
                        dispatchTracked({
                          type: "UPDATE_WEEK",
                          weekIndex: weekIdx,
                          payload: { is_deload: e.target.checked },
                        })
                      }
                      className="h-3 w-3"
                    />
                    Deload
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (!confirm(`Удалить неделю ${week.week_number}? Все дни и упражнения будут удалены.`)) return;
                      dispatchTracked({ type: "DELETE_WEEK", weekIndex: weekIdx });
                    }}
                    className="h-7 px-2 text-destructive hover:text-destructive ml-auto"
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Удалить неделю
                  </Button>
                </div>

                {(week.days ?? []).map((day, dayIdx) => (
                  <DaySection
                    key={dayIdx}
                    day={day}
                    weekIndex={weekIdx}
                    dayIndex={dayIdx}
                    dispatch={dispatchTracked}
                  />
                ))}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    dispatchTracked({ type: "ADD_DAY", weekIndex: weekIdx })
                  }
                  className="h-7 text-xs"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Добавить день
                </Button>
              </div>
            </AccordionPanel>
          </AccordionItem>
        ))}
      </Accordion>

      <Button
        type="button"
        variant="outline"
        onClick={() => dispatchTracked({ type: "ADD_WEEK" })}
      >
        <Plus className="h-4 w-4 mr-1" />
        Добавить неделю
      </Button>

      <Separator className="my-6" />

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <>
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              Сохранение...
            </>
          ) : (
            "Сохранить"
          )}
        </Button>
      </div>
    </div>
  );
}
