"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Check } from "lucide-react";
import { logWorkoutFromWeb } from "../actions";
import type { ParsedExercise } from "@/lib/program-utils";

function toNum(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type ExerciseInput = {
  exercise: string;
  sets: string;
  reps: string;
  weight: string;
  rpe: string;
  comment: string;
};

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
  const [inputs, setInputs] = useState<ExerciseInput[]>(
    exercises.map((ex) => ({
      exercise: ex.name,
      sets: "",
      reps: ex.reps ?? "",
      weight: "",
      rpe: "",
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
    setSaving(true);
    setError(null);
    try {
      const payload = inputs.map((inp) => ({
        exercise: inp.exercise,
        sets: toNum(inp.sets),
        reps: inp.reps || null,
        weight: toNum(inp.weight),
        rpe: toNum(inp.rpe),
        comment: inp.comment || null,
      }));
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
      {exercises.map((ex, i) => (
        <Card key={i}>
          <CardHeader>
            <CardTitle className="text-sm">{ex.name}</CardTitle>
            {ex.block && (
              <p className="text-xs text-muted-foreground">{ex.block}</p>
            )}
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className="text-xs text-muted-foreground">Подходы</label>
                <Input
                  value={inputs[i].sets}
                  onChange={(e) => updateField(i, "sets", e.target.value)}
                  placeholder={ex.sets ?? "—"}
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Повторы</label>
                <Input
                  value={inputs[i].reps}
                  onChange={(e) => updateField(i, "reps", e.target.value)}
                  placeholder={ex.reps ?? "—"}
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Вес</label>
                <Input
                  value={inputs[i].weight}
                  onChange={(e) => updateField(i, "weight", e.target.value)}
                  placeholder="кг"
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">RPE</label>
                <Input
                  value={inputs[i].rpe}
                  onChange={(e) => updateField(i, "rpe", e.target.value)}
                  placeholder="1-10"
                  className="h-8 text-xs"
                />
              </div>
            </div>
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
      ))}

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
