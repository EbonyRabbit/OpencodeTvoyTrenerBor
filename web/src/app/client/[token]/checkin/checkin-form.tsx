"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Check, Plus } from "lucide-react";
import { saveCheckin, type CheckinInput } from "../actions";
import type { Database } from "@/types/supabase";

type CheckinRow = Database["public"]["Tables"]["checkins"]["Row"];

type FieldDef = {
  key: keyof CheckinInput;
  label: string;
  placeholder: string;
  type: "number" | "text";
  min?: number;
  max?: number;
  step?: number;
};

const REQUIRED_FIELDS: FieldDef[] = [
  { key: "wellbeing", label: "Самочувствие", placeholder: "1-10", type: "number", min: 1, max: 10 },
  { key: "sleep", label: "Часы сна", placeholder: "например, 7.5", type: "number", min: 0, max: 24, step: 0.5 },
  { key: "stress", label: "Уровень стресса", placeholder: "1-10", type: "number", min: 1, max: 10 },
  { key: "nutrition_adherence", label: "Придержание питания", placeholder: "0-100%", type: "number", min: 0, max: 100 },
  { key: "missed_workouts", label: "Пропущено тренировок", placeholder: "0", type: "number", min: 0, max: 30, step: 1 },
];

const EMPTY_VALUES: Record<string, string> = {
  wellbeing: "",
  sleep: "",
  stress: "",
  nutrition_adherence: "",
  missed_workouts: "",
};

export function CheckinForm({ existing }: { existing: CheckinRow | null }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(!existing);
  const [values, setValues] = useState<Record<string, string>>(EMPTY_VALUES);
  const [complaints, setComplaints] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateField = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const wellbeing = Number(values.wellbeing);
      const sleep = Number(values.sleep);
      const stress = Number(values.stress);
      const nutrition_adherence = Number(values.nutrition_adherence);
      const missed_workouts = Number(values.missed_workouts);

      if (values.wellbeing === "" || !Number.isFinite(wellbeing) || wellbeing < 1 || wellbeing > 10) {
        setError("Самочувствие должно быть от 1 до 10");
        setSaving(false);
        return;
      }
      if (values.sleep === "" || !Number.isFinite(sleep) || sleep < 0 || sleep > 24) {
        setError("Часы сна должны быть от 0 до 24");
        setSaving(false);
        return;
      }
      if (values.stress === "" || !Number.isFinite(stress) || stress < 1 || stress > 10) {
        setError("Стресс должен быть от 1 до 10");
        setSaving(false);
        return;
      }
      if (values.nutrition_adherence === "" || !Number.isFinite(nutrition_adherence) || nutrition_adherence < 0 || nutrition_adherence > 100) {
        setError("Придержание питания должно быть от 0 до 100");
        setSaving(false);
        return;
      }
      if (values.missed_workouts === "" || !Number.isFinite(missed_workouts) || !Number.isInteger(missed_workouts) || missed_workouts < 0 || missed_workouts > 30) {
        setError("Пропущенные тренировки: целое число от 0 до 30");
        setSaving(false);
        return;
      }

      const m: CheckinInput = {
        wellbeing,
        sleep,
        stress,
        nutrition_adherence,
        missed_workouts,
        complaints: complaints || null,
        comment: comment || null,
      };

      const result = await saveCheckin(m);
      if (result.error) {
        setError(result.error);
      } else {
        setSaved(true);
        setShowForm(false);
        setValues(EMPTY_VALUES);
        setComplaints("");
        setComment("");
        router.refresh();
      }
    } catch {
      setError("Произошла ошибка");
    } finally {
      setSaving(false);
    }
  };

  if (saved && !showForm) {
    return (
      <Card>
        <CardContent className="py-8 text-center" aria-live="polite">
          <Check className="mx-auto mb-2 h-8 w-8 text-green-600" />
          <p className="text-lg font-semibold">Чек-ин сохранён!</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Спасибо за обратную связь
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => {
              setSaved(false);
              setShowForm(true);
            }}
          >
            <Plus className="mr-1 h-3 w-3" />
            Ещё один чек-ин
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!showForm && existing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Чек-ин — сегодня</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <span className="text-xs text-muted-foreground">Самочувствие</span>
              <p className="font-medium">{existing.wellbeing}/10</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Сон</span>
              <p className="font-medium">{existing.sleep}ч</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Стресс</span>
              <p className="font-medium">{existing.stress}/10</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Придержание</span>
              <p className="font-medium">{existing.nutrition_adherence}%</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Пропущено</span>
              <p className="font-medium">{existing.missed_workouts}</p>
            </div>
          </div>
          {existing.complaints && (
            <p className="text-xs text-muted-foreground">⚠️ {existing.complaints}</p>
          )}
          {existing.comment && (
            <p className="text-xs text-muted-foreground">💬 {existing.comment}</p>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSaved(false);
              setShowForm(true);
            }}
          >
            <Plus className="mr-1 h-3 w-3" />
            Заполнить новый чек-ин
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Новый чек-ин</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {REQUIRED_FIELDS.map((field) => {
            const inputId = `checkin-${field.key}`;
            return (
              <div key={field.key}>
                <label
                  htmlFor={inputId}
                  className="text-xs text-muted-foreground"
                >
                  {field.label}
                </label>
                <Input
                  id={inputId}
                  type={field.type}
                  value={values[field.key]}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="h-9"
                  inputMode="decimal"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                />
              </div>
            );
          })}
        </div>

        <div>
          <label
            htmlFor="checkin-complaints"
            className="text-xs text-muted-foreground"
          >
            Жалобы или боли
          </label>
          <textarea
            id="checkin-complaints"
            value={complaints}
            onChange={(e) => setComplaints(e.target.value)}
            placeholder="Необязательно"
            rows={2}
            maxLength={2000}
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
          />
        </div>

        <div>
          <label
            htmlFor="checkin-comment"
            className="text-xs text-muted-foreground"
          >
            Комментарий
          </label>
          <textarea
            id="checkin-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Необязательно"
            rows={2}
            maxLength={2000}
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
          />
        </div>

        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

        <Button onClick={handleSave} disabled={saving} className="w-full">
          {saving ? (
            <>
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              Сохранение...
            </>
          ) : (
            "Сохранить чек-ин"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
