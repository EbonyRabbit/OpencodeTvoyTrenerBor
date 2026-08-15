"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Trash2 } from "lucide-react";
import { createExercise, updateExercise, deleteExercise } from "../actions";
import { defaultExerciseForm, type ExerciseFormData } from "../form-data";
import type { Database } from "@/types/supabase";

type ExerciseRow = Database["public"]["Tables"]["exercises"]["Row"];

function textareaClass(): string {
  return "h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground">
        {label}
        {hint && <span className="font-normal"> — {hint}</span>}
      </label>
      {children}
    </div>
  );
}

function lineList(value: string[], onChange: (next: string[]) => void): {
  value: string;
  set: (raw: string) => void;
} {
  return {
    value: value.join("\n"),
    set: (raw) => onChange(raw.split("\n")),
  };
}

export function ExerciseForm({ exercise, onDone }: { exercise?: ExerciseRow; onDone: () => void }) {
  const [form, setForm] = useState<ExerciseFormData>(() =>
    exercise
      ? {
          name: exercise.name,
          aliases: exercise.aliases ?? [],
          descriptionRu: exercise.description_ru ?? "",
          descriptionEn: exercise.description_en ?? "",
          techniqueRu: exercise.technique_ru ?? "",
          techniqueEn: exercise.technique_en ?? "",
          featuresRu: exercise.features_ru ?? [],
          featuresEn: exercise.features_en ?? [],
          videoUrl: exercise.video_url ?? "",
          muscleGroup: exercise.muscle_group ?? "",
          equipment: exercise.equipment ?? "",
          difficulty: exercise.difficulty ?? "",
          contraindications: exercise.contraindications ?? "",
        }
      : defaultExerciseForm(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const ruAliases = lineList(form.aliases, (v) => setForm({ ...form, aliases: v }));
  const ruFeatures = lineList(form.featuresRu, (v) => setForm({ ...form, featuresRu: v }));
  const enFeatures = lineList(form.featuresEn, (v) => setForm({ ...form, featuresEn: v }));

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const result = exercise
        ? await updateExercise(exercise.id, form)
        : await createExercise(form);
      if (result.error) {
        setError(result.error);
      } else {
        if (!exercise) setForm(defaultExerciseForm());
        onDone();
      }
    } catch {
      setError("Произошла ошибка");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!exercise) return;
    if (!window.confirm(`Удалить упражнение «${exercise.name}» из библиотеки?`)) return;
    setError(null);
    setDeleting(true);
    try {
      const result = await deleteExercise(exercise.id);
      if (result.error) {
        setError(result.error);
        setDeleting(false);
        return;
      }
      onDone();
    } catch {
      setError("Произошла ошибка");
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Название *">
          <Input
            autoFocus={!exercise}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Жим штанги лёжа"
            className="h-8 text-xs"
            maxLength={120}
          />
        </Field>
        <Field label="Алиасы" hint="по одному в строке">
          <textarea
            value={ruAliases.value}
            onChange={(e) => ruAliases.set(e.target.value)}
            placeholder={"Жим лёжа\nBench Press"}
            className={textareaClass()}
            maxLength={30 * (200 + 1)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Группа мышц">
          <Input
            value={form.muscleGroup}
            onChange={(e) => setForm({ ...form, muscleGroup: e.target.value })}
            placeholder="Грудь"
            className="h-8 text-xs"
            maxLength={4000}
          />
        </Field>
        <Field label="Оборудование">
          <Input
            value={form.equipment}
            onChange={(e) => setForm({ ...form, equipment: e.target.value })}
            placeholder="Штанга, скамья"
            className="h-8 text-xs"
            maxLength={4000}
          />
        </Field>
        <Field label="Сложность">
          <Select
            value={form.difficulty || "any"}
            onValueChange={(v) => setForm({ ...form, difficulty: v && v !== "any" ? v : "" })}
          >
            <SelectTrigger className="h-8 w-full text-xs">
              <SelectValue placeholder="Любая" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Любая</SelectItem>
              <SelectItem value="beginner">Новичок</SelectItem>
              <SelectItem value="intermediate">Средний</SelectItem>
              <SelectItem value="advanced">Продвинутый</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Field label="RU — техника выполнения">
            <textarea
              value={form.techniqueRu}
              onChange={(e) => setForm({ ...form, techniqueRu: e.target.value })}
              placeholder="Пошаговая техника на русском"
              className={textareaClass()}
              maxLength={4000}
            />
          </Field>
          <Field label="RU — особенности" hint="по одному в строке">
            <textarea
              value={ruFeatures.value}
              onChange={(e) => ruFeatures.set(e.target.value)}
              placeholder={"Лопатки прижаты\nКолени в сторону носков"}
              className={textareaClass()}
              maxLength={30 * (200 + 1)}
            />
          </Field>
        </div>
        <div className="space-y-2">
          <Field label="EN — technique">
            <textarea
              value={form.techniqueEn}
              onChange={(e) => setForm({ ...form, techniqueEn: e.target.value })}
              placeholder="Step-by-step technique in English"
              className={textareaClass()}
              maxLength={4000}
            />
          </Field>
          <Field label="EN — features" hint="one per line">
            <textarea
              value={enFeatures.value}
              onChange={(e) => enFeatures.set(e.target.value)}
              placeholder={"Keep shoulder blades retracted\nKnees over toes"}
              className={textareaClass()}
              maxLength={30 * (200 + 1)}
            />
          </Field>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="RU — описание">
          <Input
            value={form.descriptionRu}
            onChange={(e) => setForm({ ...form, descriptionRu: e.target.value })}
            placeholder="Краткое описание упражнения"
            className="h-8 text-xs"
            maxLength={4000}
          />
        </Field>
        <Field label="EN — description">
          <Input
            value={form.descriptionEn}
            onChange={(e) => setForm({ ...form, descriptionEn: e.target.value })}
            placeholder="Short exercise description"
            className="h-8 text-xs"
            maxLength={4000}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Ссылка на видео (YouTube)">
          <Input
            value={form.videoUrl}
            onChange={(e) => setForm({ ...form, videoUrl: e.target.value })}
            placeholder="https://www.youtube.com/watch?v=..."
            className="h-8 text-xs"
          />
        </Field>
        <Field label="Противопоказания">
          <Input
            value={form.contraindications}
            onChange={(e) => setForm({ ...form, contraindications: e.target.value })}
            placeholder="Ограничения и противопоказания"
            className="h-8 text-xs"
            maxLength={4000}
          />
        </Field>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          {exercise ? "Сохранить" : "Добавить"}
        </Button>
        {exercise && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleDelete}
            disabled={deleting}
            className="text-destructive hover:text-destructive"
          >
            {deleting ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="mr-1 h-3 w-3" />
            )}
            Удалить
          </Button>
        )}
      </div>
    </div>
  );
}