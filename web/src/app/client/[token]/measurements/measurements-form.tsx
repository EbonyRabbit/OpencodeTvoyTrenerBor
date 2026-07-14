"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Check } from "lucide-react";
import { saveMeasurements } from "../actions";

function toNum(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type MeasurementField = {
  key: string;
  label: string;
  placeholder: string;
};

const FIELDS: MeasurementField[] = [
  { key: "weight", label: "Вес", placeholder: "кг" },
  { key: "chest", label: "Грудь", placeholder: "см" },
  { key: "waist", label: "Талия", placeholder: "см" },
  { key: "hips", label: "Бёдра", placeholder: "см" },
  { key: "left_arm", label: "Левая рука", placeholder: "см" },
  { key: "right_arm", label: "Правая рука", placeholder: "см" },
];

export function MeasurementsForm({ date }: { date: string }) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.key, ""])),
  );
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
      const measurements = {
        weight: toNum(values.weight),
        chest: toNum(values.chest),
        waist: toNum(values.waist),
        hips: toNum(values.hips),
        left_arm: toNum(values.left_arm),
        right_arm: toNum(values.right_arm),
      };
      const hasData = Object.values(measurements).some((v) => v !== null);
      if (!hasData) {
        setError("Заполните хотя бы один параметр");
        setSaving(false);
        return;
      }
      const result = await saveMeasurements(date, { ...measurements, comment: comment || null });
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
          <p className="text-lg font-semibold">Замеры сохранены!</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Замеры тела</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {FIELDS.map((field) => (
            <div key={field.key}>
              <label className="text-xs text-muted-foreground">{field.label}</label>
              <Input
                value={values[field.key]}
                onChange={(e) => updateField(field.key, e.target.value)}
                placeholder={field.placeholder}
                className="h-9"
              />
            </div>
          ))}
        </div>
        <div className="mt-4">
          <label className="text-xs text-muted-foreground">Комментарий</label>
          <Input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Необязательно"
            className="h-9"
          />
        </div>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <Button onClick={handleSave} disabled={saving} className="mt-4 w-full">
          {saving ? (
            <>
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              Сохранение...
            </>
          ) : (
            "Сохранить замеры"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
