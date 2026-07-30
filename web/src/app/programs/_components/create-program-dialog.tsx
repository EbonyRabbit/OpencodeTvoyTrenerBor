"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createProgram } from "../[id]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function CreateProgramDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [durationWeeks, setDurationWeeks] = useState("12");
  const [equipment, setEquipment] = useState("");
  const [language, setLanguage] = useState("ru");

  const canSubmit = useMemo(() => {
    if (loading) return false;
    if (!title.trim()) return false;
    const weeks = Number(durationWeeks);
    if (!Number.isFinite(weeks) || !Number.isInteger(weeks) || weeks < 1 || weeks > 52) return false;
    return true;
  }, [loading, title, durationWeeks]);

  const reset = useCallback(() => {
    setTitle("");
    setDescription("");
    setDurationWeeks("12");
    setEquipment("");
    setLanguage("ru");
    setError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    setError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Введите название программы");
      return;
    }

    const weeks = Number(durationWeeks);
    if (!Number.isFinite(weeks) || weeks < 1 || weeks > 52) {
      setError("Длительность от 1 до 52 недель");
      return;
    }

    setLoading(true);
    try {
      const result = await createProgram({
        title: trimmedTitle,
        description: description.trim() || undefined,
        duration_weeks: weeks,
        equipment: equipment.trim() || undefined,
        language,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      if (result.id) {
        reset();
        setOpen(false);
        router.push(`/programs/${result.id}/edit`);
      }
    } catch {
      setError("Произошла ошибка");
    } finally {
      setLoading(false);
    }
  }, [title, description, durationWeeks, equipment, language, reset, router]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (loading && !nextOpen) return;
        setOpen(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogTrigger render={<Button />}>Новая программа</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новая программа</DialogTitle>
          <DialogDescription>
            Создайте программу и перейдите в редактор, чтобы добавить
            тренировки.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <label htmlFor="program-title" className="text-sm font-medium">
                Название *
              </label>
              <Input
                id="program-title"
                placeholder="Сила Новичка 12 недель"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={loading}
                autoFocus
                aria-required="true"
              />
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="program-desc" className="text-sm font-medium">
                Описание
              </label>
              <Input
                id="program-desc"
                placeholder="Краткое описание программы"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="grid gap-1.5">
              <label
                htmlFor="program-duration"
                className="text-sm font-medium"
              >
                Длительность (недель) *
              </label>
              <Input
                id="program-duration"
                type="number"
                min="1"
                max="52"
                step="1"
                value={durationWeeks}
                onChange={(e) => setDurationWeeks(e.target.value)}
                disabled={loading}
                aria-required="true"
              />
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="program-equipment" className="text-sm font-medium">
                Инвентарь
              </label>
              <Input
                id="program-equipment"
                placeholder="Штанга, гантели, турник..."
                value={equipment}
                onChange={(e) => setEquipment(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="grid gap-1.5">
              <label id="label-language" className="text-sm font-medium">
                Язык
              </label>
              <Select
                value={language}
                onValueChange={(v) => v && setLanguage(v)}
              >
                <SelectTrigger
                  className="w-full"
                  aria-labelledby="label-language"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ru">Русский</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Отмена
            </DialogClose>
            <Button type="submit" disabled={!canSubmit}>
              {loading ? "Создание..." : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
