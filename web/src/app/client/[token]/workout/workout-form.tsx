"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Check } from "lucide-react";
import { logWorkoutFromWeb } from "../actions";
import { flattenLoggableExercises, getCompositeLetters, type ParsedExercise } from "@/lib/program-utils";

function toNum(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function toPace(v: string): string | null {
  const trimmed = v.trim().toLowerCase().replace(/мин\/км|\/км|\/km/g, "").trim();
  if (!trimmed) return null;
  const time = trimmed.match(/^(\d{1,3})\s*:\s*(\d{2})$/);
  if (time) {
    const minutes = Number(time[1]);
    const seconds = Number(time[2]);
    return seconds <= 59 && minutes <= 599 ? `${minutes}:${time[2]}` : null;
  }
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) && value > 0 && value <= 30 ? String(value) : null;
}

function amrapRoundsToInt(v: string): number | null {
  const trimmed = v.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed === "макс" || trimmed === "max" || trimmed === "максимум") return -1;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function heartRateToInt(v: string): number | null {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const range = trimmed.match(/^(\d{2,3})\s*[-–]\s*(\d{2,3})$/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (a < 30 || b > 250 || a > b) return null;
    return Math.round((a + b) / 2);
  }
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 30 && n <= 250 ? n : null;
}

function toDurationSec(v: string): number | null {
  const trimmed = v.trim().toLowerCase();
  if (!trimmed) return null;
  if (/^(\d{1,2}):(\d{2}):(\d{2})$/.test(trimmed)) {
    const [h, m, s] = trimmed.split(":").map(Number);
    if (s > 59 || m > 59) return null;
    return h * 3600 + m * 60 + s;
  }
  const hm = trimmed.match(/^(\d{1,3}):(\d{1,2})$/);
  if (hm) {
    const m = Number(hm[1]);
    const s = Number(hm[2]);
    if (s > 59) return null;
    return m * 60 + s;
  }
  const minutes = trimmed.match(/^(\d+(?:[.,]\d+)?)\s*(?:мин|м|минут|минуты)?$/);
  if (minutes) {
    const value = Math.round(Number(minutes[1].replace(",", ".")) * 60);
    return value > 0 && value <= 86400 ? value : null;
  }
  const seconds = trimmed.match(/^(\d+(?:[.,]\d+)?)\s*(?:сек|с|секунд)/);
  if (seconds) {
    const value = Math.round(Number(seconds[1].replace(",", ".")));
    return value > 0 && value <= 86400 ? value : null;
  }
  return null;
}

type ExerciseInput = {
  exercise: string;
  sets: string;
  reps: string;
  weight: string;
  rpe: string;
  rounds: string;
  distance: string;
  duration: string;
  pace: string;
  heart_rate: string;
  comment: string;
};

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 text-xs"
      />
    </div>
  );
}

export function WorkoutForm({
  exercises,
  date,
  week,
  dayOrder,
}: {
  exercises: ParsedExercise[];
  date: string;
  week: number | null;
  dayOrder: number | null;
}) {
  const leaves = flattenLoggableExercises(exercises);
  const letters = getCompositeLetters(exercises);
  const leafBadge = (leaf: ParsedExercise, leafIndex: number): string | null => {
    let offset = 0;
    for (let i = 0; i < exercises.length; i++) {
      const ex = exercises[i];
      if (ex.type === "superset") {
        const count = ex.children?.length ?? 0;
        if (leafIndex >= offset && leafIndex < offset + count) {
          return `${letters.get(i) ?? "A"}${leafIndex - offset + 1}`;
        }
        offset += count;
      } else {
        if (leafIndex === offset) return null;
        offset += 1;
      }
    }
    return null;
  };

  const [inputs, setInputs] = useState<ExerciseInput[]>(
    leaves.map((ex) => ({
      exercise: ex.name,
      sets: "",
      reps: ex.reps ?? "",
      weight: "",
      rpe: "",
      rounds: "",
      distance: "",
      duration: "",
      pace: "",
      heart_rate: "",
      comment: "",
    })),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateField = (index: number, field: keyof ExerciseInput, value: string) => {
    setInputs((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };

  const handleSave = async () => {
    setError(null);
    for (let i = 0; i < leaves.length; i++) {
      const ex = leaves[i];
      const inp = inputs[i];
      const type = ex.type ?? "strength";
      if (type === "cardio") {
        if (!inp.duration.trim() || toDurationSec(inp.duration) == null) {
          setError(`${ex.name}: укажите корректное время`);
          return;
        }
        if (!inp.distance.trim() || toNum(inp.distance) == null || toNum(inp.distance)! <= 0) {
          setError(`${ex.name}: укажите дистанцию больше 0 км`);
          return;
        }
        if (!inp.pace.trim() || toPace(inp.pace) == null) {
          setError(`${ex.name}: укажите темп, например 5:30`);
          return;
        }
        if (!inp.heart_rate.trim() || heartRateToInt(inp.heart_rate) == null) {
          setError(`${ex.name}: укажите пульс от 30 до 250`);
          return;
        }
      } else if (type === "circuit") {
        if (!inp.rounds.trim() || amrapRoundsToInt(inp.rounds) == null) {
          setError(`${ex.name}: укажите число раундов или МАКС`);
          return;
        }
      } else {
        if (inp.sets.trim() && (toNum(inp.sets) == null || !Number.isInteger(toNum(inp.sets)))) {
          setError(`${ex.name}: подходы должны быть целым неотрицательным числом`);
          return;
        }
        if (inp.weight.trim() && toNum(inp.weight) == null) {
          setError(`${ex.name}: вес не может быть отрицательным`);
          return;
        }
        const rpe = toNum(inp.rpe);
        if (inp.rpe.trim() && (rpe == null || !Number.isInteger(rpe) || rpe < 1 || rpe > 10)) {
          setError(`${ex.name}: RPE должен быть целым числом от 1 до 10`);
          return;
        }
      }
    }

    setSaving(true);
    try {
      const payload = leaves.map((ex, i) => {
        const inp = inputs[i];
        const type = ex.type ?? "strength";
        if (type === "cardio") {
          return {
            type: "cardio" as const,
            exercise: ex.name,
            sets: null,
            reps: null,
            weight: null,
            rpe: null,
            rounds: null,
            distance_km: toNum(inp.distance),
            duration_sec: toDurationSec(inp.duration),
            heart_rate: heartRateToInt(inp.heart_rate),
            pace: toPace(inp.pace),
            comment: inp.comment || null,
          };
        }
        if (type === "circuit") {
          return {
            type: "circuit" as const,
            exercise: ex.name,
            sets: null,
            reps: null,
            weight: null,
            rpe: null,
            rounds: amrapRoundsToInt(inp.rounds),
            distance_km: null,
            duration_sec: null,
            heart_rate: null,
            pace: null,
            comment: inp.comment || null,
          };
        }
        return {
          type: "strength" as const,
          exercise: ex.name,
          sets: toNum(inp.sets),
          reps: inp.reps || null,
          weight: toNum(inp.weight),
          rpe: toNum(inp.rpe),
          rounds: null,
          distance_km: null,
          duration_sec: null,
          heart_rate: null,
          pace: null,
          comment: inp.comment || null,
        };
      });
      const result = await logWorkoutFromWeb(date, week, dayOrder, payload);
      if (result.error) {
        setError(result.error);
      } else {
        setSaved(true);
      }
    } catch {
      setError("Произошла ошибка");
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Check className="mx-auto mb-2 h-8 w-8 text-green-600" />
          <p className="text-lg font-semibold">Тренировка сохранена!</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {leaves.map((ex, i) => {
        const type = ex.type ?? "strength";
        const badge = leafBadge(ex, i);
        return (
          <Card key={i}>
            <CardContent className="pt-5">
              <div className="mb-2 flex items-center gap-2">
                {badge && (
                  <span className="text-xs font-semibold text-muted-foreground">{badge}</span>
                )}
                <p className="text-sm font-semibold">{ex.name}</p>
                {badge && <Badge variant="secondary" className="text-[10px]">СУПЕРСЕТ</Badge>}
                {type === "cardio" && <Badge variant="secondary" className="text-[10px]">КАРДИО</Badge>}
                {type === "circuit" && <Badge variant="secondary" className="text-[10px]">КРУГ</Badge>}
              </div>
              {ex.block && (
                <p className="mb-2 text-xs text-muted-foreground">{ex.block}</p>
              )}
              {type === "cardio" ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field label="Время" value={inputs[i].duration} onChange={(v) => updateField(i, "duration", v)} placeholder={ex.duration ?? "мин"} />
                  <Field label="Дистанция, км" value={inputs[i].distance} onChange={(v) => updateField(i, "distance", v)} placeholder={ex.distance ?? "км"} />
                  <Field label="Темп" value={inputs[i].pace} onChange={(v) => updateField(i, "pace", v)} placeholder={ex.pace ?? "5:30"} />
                  <Field label="Пульс" value={inputs[i].heart_rate} onChange={(v) => updateField(i, "heart_rate", v)} placeholder={ex.heart_rate ?? "140"} />
                </div>
              ) : type === "circuit" ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field label="Раунды" value={inputs[i].rounds} onChange={(v) => updateField(i, "rounds", v)} placeholder={ex.rounds ?? "МАКС"} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field label="Подходы" value={inputs[i].sets} onChange={(v) => updateField(i, "sets", v)} placeholder={ex.sets ?? "—"} />
                  <Field label="Повторы" value={inputs[i].reps} onChange={(v) => updateField(i, "reps", v)} placeholder={ex.reps ?? "—"} />
                  <Field label="Вес" value={inputs[i].weight} onChange={(v) => updateField(i, "weight", v)} placeholder="кг" />
                  <Field label="RPE" value={inputs[i].rpe} onChange={(v) => updateField(i, "rpe", v)} placeholder="1-10" />
                </div>
              )}
              <div className="mt-2">
                <label className="text-xs text-muted-foreground">Комментарий</label>
                <Input
                  value={inputs[i].comment}
                  onChange={(e) => updateField(i, "comment", e.target.value)}
                  placeholder="Необязательно"
                  className="h-8 text-xs"
                />
              </div>
            </CardContent>
          </Card>
        );
      })}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button onClick={handleSave} disabled={saving} className="w-full">
        {saving ? (
          <>
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            Сохранение...
          </>
        ) : (
          "Завершить тренировку"
        )}
      </Button>
    </div>
  );
}
