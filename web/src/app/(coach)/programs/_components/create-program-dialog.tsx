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
  const [price, setPrice] = useState("");
  const [type, setType] = useState<"template" | "personal">("template");
  const [sport, setSport] = useState<
    "tennis" | "running" | "triathlon" | "swimming" | "hyrox" | "general"
  >("general");

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
    setPrice("");
    setType("template");
    setSport("general");
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

    let parsedPrice: number | undefined;
    if (price.trim()) {
      parsedPrice = Number(price);
      if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
        setError("Цена должна быть положительным числом");
        return;
      }
    }

    setLoading(true);
    try {
      const result = await createProgram({
        title: trimmedTitle,
        description: description.trim() || undefined,
        duration_weeks: weeks,
        equipment: equipment.trim() || undefined,
        language,
        price: parsedPrice,
        type,
        sport,
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
  }, [title, description, durationWeeks, equipment, language, price, type, sport, reset, router]);

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
              <label htmlFor="program-price" className="text-sm font-medium">
                Цена (₽)
              </label>
              <Input
                id="program-price"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="Например: 9900. Пусто — по запросу"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
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

            <div className="grid gap-1.5">
              <label id="label-type" className="text-sm font-medium">
                Тип
              </label>
              <Select
                value={type}
                onValueChange={(v) => {
                  if (v === "template" || v === "personal") setType(v);
                }}
              >
                <SelectTrigger
                  className="w-full"
                  aria-labelledby="label-type"
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
              <p className="text-xs text-muted-foreground">
                Персональные программы не отображаются в меню покупки в
                Telegram-боте.
              </p>
            </div>

            <div className="grid gap-1.5">
              <label id="label-sport" className="text-sm font-medium">
                Вид спорта
              </label>
              <Select
                value={sport}
                onValueChange={(v) => {
                  if (
                    v === "tennis" ||
                    v === "running" ||
                    v === "triathlon" ||
                    v === "swimming" ||
                    v === "hyrox" ||
                    v === "general"
                  ) {
                    setSport(v);
                  }
                }}
              >
                <SelectTrigger
                  className="w-full"
                  aria-labelledby="label-sport"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">Общее</SelectItem>
                  <SelectItem value="tennis">🎾 Теннис</SelectItem>
                  <SelectItem value="running">🏃 Бег</SelectItem>
                  <SelectItem value="triathlon">🚴 Триатлон</SelectItem>
                  <SelectItem value="swimming">🏊 Плавание</SelectItem>
                  <SelectItem value="hyrox">🏋️ HYROX</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Спорт-специфичные шаблоны сгруппированы по виду спорта в
                каталоге бота и веб-панели.
              </p>
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
