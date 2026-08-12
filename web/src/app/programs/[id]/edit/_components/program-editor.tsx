"use client";

import { useState, useReducer, useCallback, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  isCompositeExercise,
  getCompositeLetters,
  type ExerciseType,
} from "@/lib/program-utils";
import { updateProgramContent, updateProgramType } from "../../actions";
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
  | { type: "UPDATE_EXERCISE"; weekIndex: number; dayIndex: number; exerciseIndex: number; payload: Partial<EditableExercise> }
  | { type: "ADD_CHILD"; weekIndex: number; dayIndex: number; exerciseIndex: number }
  | { type: "DELETE_CHILD"; weekIndex: number; dayIndex: number; exerciseIndex: number; childIndex: number }
  | { type: "UPDATE_CHILD"; weekIndex: number; dayIndex: number; exerciseIndex: number; childIndex: number; payload: Partial<EditableExercise> };

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
              emptyExercise(),
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

    case "ADD_CHILD": {
      const weeks = (state.weeks ?? []).map((w, i) => {
        if (i !== action.weekIndex) return w;
        const days = (w.days ?? []).map((d, j) => {
          if (j !== action.dayIndex) return d;
          const exercises = (d.exercises ?? []).map((e, k) => {
            if (k !== action.exerciseIndex) return e;
            return {
              ...e,
              children: [
                ...(e.children ?? []),
                emptyExercise(),
              ],
            };
          });
          return { ...d, exercises };
        });
        return { ...w, days };
      });
      return { ...state, weeks };
    }

    case "DELETE_CHILD": {
      const weeks = (state.weeks ?? []).map((w, i) => {
        if (i !== action.weekIndex) return w;
        const days = (w.days ?? []).map((d, j) => {
          if (j !== action.dayIndex) return d;
          const exercises = (d.exercises ?? []).map((e, k) => {
            if (k !== action.exerciseIndex) return e;
            return { ...e, children: (e.children ?? []).filter((_, ci) => ci !== action.childIndex) };
          });
          return { ...d, exercises };
        });
        return { ...w, days };
      });
      return { ...state, weeks };
    }

    case "UPDATE_CHILD": {
      const weeks = (state.weeks ?? []).map((w, i) => {
        if (i !== action.weekIndex) return w;
        const days = (w.days ?? []).map((d, j) => {
          if (j !== action.dayIndex) return d;
          const exercises = (d.exercises ?? []).map((e, k) => {
            if (k !== action.exerciseIndex) return e;
            const children = (e.children ?? []).map((c, ci) =>
              ci === action.childIndex ? { ...c, ...action.payload } : c
            );
            return { ...e, children };
          });
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

function emptyExercise(): EditableExercise {
  return { name: "", type: "strength", block: "", sets: "", reps: "", weight: "", rpe: "", rest: "", notes: "" };
}

function autofillCompositeName(exercise: EditableExercise): EditableExercise {
  if (exercise.name.trim()) return exercise;
  if (exercise.type === "superset") {
    const names = (exercise.children ?? [])
      .map((c) => c.name.trim())
      .filter(Boolean);
    if (names.length >= 2) {
      return { ...exercise, name: names.join(" + ") };
    }
  }
  if (exercise.type === "circuit") {
    return { ...exercise, name: "AMRAP" };
  }
  return exercise;
}

function validateDayExercises(exercises: EditableExercise[]): string | null {
  const all = exercises.flatMap((ex) => [ex, ...(ex.children ?? [])]);
  const emptyNames = all.filter((e) => !e.name.trim());
  if (emptyNames.length > 0) {
    return `Заполните название у ${emptyNames.length} упражнени${emptyNames.length === 1 ? "я" : "й"}`;
  }
  for (const ex of exercises) {
    if (ex.type === "superset") {
      const children = ex.children ?? [];
      if (children.length < 2) {
        return `Суперсет «${ex.name}» — нужно минимум 2 упражнения в группе`;
      }
    }
    if (ex.type === "circuit") {
      const children = ex.children ?? [];
      if (children.length < 1) {
        return `Круг «${ex.name}» — добавьте хотя бы одно упражнение`;
      }
    }
  }
  return null;
}

function ParamField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value?: string;
  onChange: (value: string | undefined) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] text-muted-foreground">{label}</label>
      <Input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        placeholder={placeholder}
        className="h-7 w-16 text-xs"
      />
    </div>
  );
}

function MetricParams({
  exercise,
  onUpdate,
}: {
  exercise: EditableExercise;
  onUpdate: (payload: Partial<EditableExercise>) => void;
}) {
  const type = exercise.type ?? "strength";

  if (type === "cardio") {
    return (
      <>
        <ParamField label="Дист." value={exercise.distance} onChange={(v) => onUpdate({ distance: v })} placeholder="500 м" />
        <ParamField label="Время" value={exercise.duration} onChange={(v) => onUpdate({ duration: v })} placeholder="20 мин" />
        <ParamField label="Темп" value={exercise.pace} onChange={(v) => onUpdate({ pace: v })} placeholder="5:30/км" />
        <ParamField label="Пульс" value={exercise.heart_rate} onChange={(v) => onUpdate({ heart_rate: v })} placeholder="140-160" />
      </>
    );
  }

  if (type === "superset") {
    return (
      <>
        <ParamField label="Подходы" value={exercise.sets} onChange={(v) => onUpdate({ sets: v })} placeholder="3" />
        <span className="self-center text-[10px] text-muted-foreground">+ отдых группы</span>
      </>
    );
  }

  if (type === "circuit") {
    return (
      <>
        <ParamField label="Раунды" value={exercise.rounds} onChange={(v) => onUpdate({ rounds: v })} placeholder="МАКС" />
        <span className="self-center text-[10px] text-muted-foreground">цель круга</span>
      </>
    );
  }

  return (
    <>
      <ParamField label="Подходы" value={exercise.sets} onChange={(v) => onUpdate({ sets: v })} placeholder="3" />
      <ParamField label="Повторы" value={exercise.reps} onChange={(v) => onUpdate({ reps: v })} placeholder="8" />
      <ParamField label="Вес" value={exercise.weight} onChange={(v) => onUpdate({ weight: v })} placeholder="60 кг" />
      <ParamField label="RPE" value={exercise.rpe} onChange={(v) => onUpdate({ rpe: v })} placeholder="8" />
    </>
  );
}

function TypeSelect({
  value,
  onChange,
  allowComposite,
}: {
  value?: ExerciseType;
  onChange: (type: ExerciseType) => void;
  allowComposite: boolean;
}) {
  const current = value ?? "strength";
  return (
    <Select
      value={current}
      onValueChange={(v) => onChange((v ?? "strength") as ExerciseType)}
    >
      <SelectTrigger className="h-7 w-24 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="strength">Сила</SelectItem>
        <SelectItem value="cardio">Кардио</SelectItem>
        {allowComposite && <SelectItem value="superset">Суперсет</SelectItem>}
        {allowComposite && <SelectItem value="circuit">Круг</SelectItem>}
      </SelectContent>
    </Select>
  );
}

function ExerciseRow({
  exercise,
  onUpdate,
  onDelete,
  label,
  allowComposite,
}: {
  exercise: EditableExercise;
  onUpdate: (payload: Partial<EditableExercise>) => void;
  onDelete: () => void;
  label?: string;
  allowComposite: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(150px,1.1fr)_92px_86px_minmax(0,1.7fr)_100px_minmax(100px,1fr)_30px] items-start gap-2">
      <div className="flex items-center gap-1">
        {label && (
          <span className="w-6 shrink-0 text-right text-[10px] font-semibold text-muted-foreground">
            {label}
          </span>
        )}
        <ExerciseAutocomplete
          value={exercise.name}
          onChange={(val) => onUpdate({ name: val })}
          placeholder="Упражнение"
          className="h-8 text-xs"
        />
      </div>
      <TypeSelect
        value={exercise.type}
        onChange={(type) => {
          const base: Partial<EditableExercise> = { type };
          if (type === "superset" || type === "circuit") {
            if (!exercise.children?.length) {
              base.children = [emptyExercise()];
            }
          } else if (exercise.children?.length) {
            base.children = [];
          }
          onUpdate(base);
        }}
        allowComposite={allowComposite}
      />
      <Input
        value={exercise.block ?? ""}
        onChange={(e) => onUpdate({ block: e.target.value || undefined })}
        placeholder="Блок"
        className="h-8 text-xs"
      />
      <div className="flex flex-wrap items-start gap-1.5">
        <MetricParams exercise={exercise} onUpdate={onUpdate} />
      </div>
      <Input
        value={exercise.rest ?? ""}
        onChange={(e) => onUpdate({ rest: e.target.value || undefined })}
        placeholder="Отдых"
        className="h-8 text-xs"
      />
      <Input
        value={exercise.notes ?? ""}
        onChange={(e) => onUpdate({ notes: e.target.value || undefined })}
        placeholder="Заметки"
        className="h-8 text-xs"
      />
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
    </div>
  );
}

function CompositeChildren({
  exercise,
  onAddChild,
  onUpdateChild,
  onDeleteChild,
  letter,
}: {
  exercise: EditableExercise;
  onAddChild: () => void;
  onUpdateChild: (childIndex: number, payload: Partial<EditableExercise>) => void;
  onDeleteChild: (childIndex: number) => void;
  letter: string;
}) {
  const children = exercise.children ?? [];
  return (
    <div className="mt-1 space-y-1 border-l border-muted pl-4">
      {children.map((child, ci) => (
        <ExerciseRow
          key={ci}
          exercise={child}
          label={`${letter}${ci + 1}`}
          onUpdate={(payload) => onUpdateChild(ci, payload)}
          onDelete={() => onDeleteChild(ci)}
          allowComposite={false}
        />
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onAddChild}
        className="h-7 text-xs"
      >
        <Plus className="h-3 w-3 mr-1" />
        Добавить в группу
      </Button>
    </div>
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
  const letters = getCompositeLetters(exercises);

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

      <div className="overflow-x-auto pb-2">
        <div className="min-w-[900px] space-y-2">
          {exercises.map((ex, exIdx) => {
            const letter = letters.get(exIdx);
            return (
              <div key={exIdx}>
                <ExerciseRow
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
                  allowComposite={true}
                />
                {isCompositeExercise(ex) && (
                  <CompositeChildren
                    exercise={ex}
                    letter={letter ?? "A"}
                    onAddChild={() =>
                      dispatch({ type: "ADD_CHILD", weekIndex, dayIndex, exerciseIndex: exIdx })
                    }
                    onUpdateChild={(childIndex, payload) =>
                      dispatch({
                        type: "UPDATE_CHILD",
                        weekIndex,
                        dayIndex,
                        exerciseIndex: exIdx,
                        childIndex,
                        payload,
                      })
                    }
                    onDeleteChild={(childIndex) =>
                      dispatch({
                        type: "DELETE_CHILD",
                        weekIndex,
                        dayIndex,
                        exerciseIndex: exIdx,
                        childIndex,
                      })
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
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
  const [typeSaving, setTypeSaving] = useState(false);
  const [typeError, setTypeError] = useState<string | null>(null);
  const [programType, setProgramType] = useState<"template" | "personal">(
    program.type === "personal" ? "personal" : "template",
  );

  const handleTypeChange = useCallback(async (next: string | null) => {
    if (next !== "template" && next !== "personal") return;
    setTypeError(null);
    setTypeSaving(true);
    try {
      const result = await updateProgramType(program.id, next);
      if (result.error) {
        setTypeError(result.error);
      } else {
        setProgramType(next);
      }
    } catch {
      setTypeError("Не удалось изменить тип программы");
    } finally {
      setTypeSaving(false);
    }
  }, [program.id]);

  const weeks = state.weeks ?? [];
  const [openPanels, setOpenPanels] = useState<string[]>(() => weeks.map((_, i) => `week-${i}`));

  useEffect(() => {
    setOpenPanels((prev) => {
      const next = weeks.map((_, i) => `week-${i}`);
      return prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next;
    });
  }, [weeks.length]);

  const handleSave = useCallback(async () => {
    const autofilled: EditableParsedContent = {
      ...state,
      weeks: (state.weeks ?? []).map((w) => ({
        ...w,
        days: (w.days ?? []).map((d) => ({
          ...d,
          exercises: (d.exercises ?? []).map(autofillCompositeName),
        })),
      })),
    };

    for (const week of autofilled.weeks ?? []) {
      for (const day of week.days ?? []) {
        const error = validateDayExercises(day.exercises ?? []);
        if (error) {
          setSaveError(error);
          return;
        }
      }
    }

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const result = await updateProgramContent(program.id, autofilled);
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
          <div className="mt-2 flex items-center gap-2">
            <label
              id="label-editor-type"
              className="text-sm text-muted-foreground"
            >
              Тип:
            </label>
            <Select
              value={programType}
              onValueChange={handleTypeChange}
            >
              <SelectTrigger
                className="h-8 w-72"
                aria-labelledby="label-editor-type"
                disabled={typeSaving}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="template">
                  Шаблон — видна в каталоге бота
                </SelectItem>
                <SelectItem value="personal">
                  Персональная — скрыта из каталога бота
                </SelectItem>
              </SelectContent>
            </Select>
            {typeSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {typeError && (
              <span className="text-xs text-destructive" role="alert">
                {typeError}
              </span>
            )}
          </div>
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

      <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Типы упражнений:</span>
        <span>Сила — подходы/повторы/вес/RPE</span>
        <span>·</span>
        <span>Кардио — дистанция/время/темп/пульс</span>
        <span>·</span>
        <span>Суперсет/Круг — группа упражнений, выполняется подряд (A1, A2…)</span>
      </div>

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
