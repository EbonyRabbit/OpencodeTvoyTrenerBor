"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Check, Pencil } from "lucide-react";
import { saveMeasurements, type MeasurementInput } from "../actions";
import type { Database } from "@/types/supabase";

type MeasurementRow = Database["public"]["Tables"]["measurements"]["Row"];

function toNum(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtVal(v: number | null): string {
  return v != null ? String(v) : "";
}

type FieldDef = { key: keyof MeasurementInput; label: string; placeholder: string };

const GROUPS: { title: string; fields: FieldDef[] }[] = [
  {
    title: "Основные",
    fields: [
      { key: "weight", label: "Вес", placeholder: "кг" },
      { key: "chest", label: "Грудь", placeholder: "см" },
      { key: "waist", label: "Талия", placeholder: "см" },
      { key: "abdomen", label: "Живот", placeholder: "см" },
      { key: "hips", label: "Бёдра", placeholder: "см" },
      { key: "glutes", label: "Ягодицы", placeholder: "см" },
    ],
  },
  {
    title: "Конечности",
    fields: [
      { key: "left_thigh", label: "Левое бедро", placeholder: "см" },
      { key: "right_thigh", label: "Правое бедро", placeholder: "см" },
      { key: "left_arm", label: "Левая рука", placeholder: "см" },
      { key: "right_arm", label: "Правая рука", placeholder: "см" },
    ],
  },
  {
    title: "Состав тела",
    fields: [
      { key: "body_fat", label: "Жировая масса", placeholder: "%" },
      { key: "muscle_mass", label: "Мышечная масса", placeholder: "кг" },
      { key: "visceral_fat", label: "Висцеральный жир", placeholder: "" },
    ],
  },
];

function buildInitialValues(existing: MeasurementRow | null): Record<string, string> {
  const vals: Record<string, string> = {};
  for (const group of GROUPS) {
    for (const f of group.fields) {
      vals[f.key] = fmtVal(existing?.[f.key] as number | null);
    }
  }
  return vals;
}

export function MeasurementsForm({
  date,
  existing,
}: {
  date: string;
  existing: MeasurementRow | null;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(
    () => buildInitialValues(existing),
  );
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(!existing);

  const updateField = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const m: MeasurementInput = {
        weight: toNum(values.weight),
        waist: toNum(values.waist),
        abdomen: toNum(values.abdomen),
        chest: toNum(values.chest),
        hips: toNum(values.hips),
        glutes: toNum(values.glutes),
        left_thigh: toNum(values.left_thigh),
        right_thigh: toNum(values.right_thigh),
        left_arm: toNum(values.left_arm),
        right_arm: toNum(values.right_arm),
        body_fat: toNum(values.body_fat),
        muscle_mass: toNum(values.muscle_mass),
        visceral_fat: toNum(values.visceral_fat),
        comment: comment || null,
      };
      const hasData = Object.entries(m).some(
        ([k, v]) => k !== "comment" && v !== null,
      );
      if (!hasData) {
        setError("Заполните хотя бы один параметр");
        setSaving(false);
        return;
      }
      const result = await saveMeasurements(date, m);
      if (result.error) {
        setError(result.error);
      } else {
        setSaved(true);
        setEditing(false);
        router.refresh();
      }
    } catch {
      setError("Произошла ошибка");
    } finally {
      setSaving(false);
    }
  };

  if (saved && !editing) {
    return (
      <Card>
        <CardContent className="py-8 text-center" aria-live="polite">
          <Check className="mx-auto mb-2 h-8 w-8 text-green-600" />
          <p className="text-lg font-semibold">Замеры сохранены!</p>
          <p className="mt-1 text-sm text-muted-foreground">{date}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => {
              setSaved(false);
              setEditing(true);
            }}
          >
            <Pencil className="mr-1 h-3 w-3" />
            Редактировать
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">
          {existing ? "Замеры тела — сегодня" : "Новые замеры"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {GROUPS.map((group) => (
          <div key={group.title} className="mb-4">
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">
              {group.title}
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {group.fields.map((field) => {
                const inputId = `meas-${field.key}`;
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
                      value={values[field.key]}
                      onChange={(e) => updateField(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className="h-9"
                      inputMode="decimal"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div className="mt-2">
          <label
            htmlFor="meas-comment"
            className="text-xs text-muted-foreground"
          >
            Комментарий
          </label>
          <textarea
            id="meas-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Необязательно"
            rows={2}
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
          />
        </div>
        {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
        <Button onClick={handleSave} disabled={saving} className="mt-4 w-full">
          {saving ? (
            <>
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              Сохранение...
            </>
          ) : existing ? (
            "Обновить замеры"
          ) : (
            "Сохранить замеры"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
