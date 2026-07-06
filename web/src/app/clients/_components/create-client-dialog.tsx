"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../actions";
import { LANGUAGE_LABELS } from "@/lib/clients";
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

const TIMEZONE_OPTIONS = [
  "UTC",
  "Europe/Moscow",
  "Europe/Kiev",
  "Europe/Minsk",
  "Asia/Almaty",
  "Asia/Tashkent",
  "Asia/Dubai",
  "Asia/Bangkok",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
];

export function CreateClientDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [telegramId, setTelegramId] = useState("");
  const [language, setLanguage] = useState("ru");
  const [timezone, setTimezone] = useState("Europe/Moscow");
  const [paymentStatus, setPaymentStatus] = useState("pending");

  const canSubmit = useMemo(
    () => !loading && name.trim().length > 0,
    [loading, name],
  );

  const reset = useCallback(() => {
    setName("");
    setTelegramId("");
    setLanguage("ru");
    setTimezone("Europe/Moscow");
    setPaymentStatus("pending");
    setError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Введите имя клиента");
      return;
    }

    const parsedTelegramId = telegramId.trim()
      ? Number(telegramId.trim())
      : null;
    if (
      parsedTelegramId !== null &&
      (!Number.isInteger(parsedTelegramId) || parsedTelegramId <= 0)
    ) {
      setError("Некорректный Telegram ID");
      return;
    }

    setLoading(true);
    try {
      const result = await createClient({
        name: trimmedName,
        telegram_id: parsedTelegramId,
        language,
        timezone,
        payment_status: paymentStatus,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      reset();
      setOpen(false);
      router.refresh();
    } catch {
      setError("Произошла ошибка");
    } finally {
      setLoading(false);
    }
  }, [name, telegramId, language, timezone, paymentStatus, reset, router]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (loading && !nextOpen) return;
        setOpen(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogTrigger render={<Button />}>Добавить клиента</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Добавить клиента</DialogTitle>
          <DialogDescription>
            Создайте нового клиента. Имя обязательно, остальные поля можно
            заполнить позже.
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
              <label htmlFor="client-name" className="text-sm font-medium">
                Имя *
              </label>
              <Input
                id="client-name"
                placeholder="Иван Иванов"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
                autoFocus
                aria-required="true"
              />
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="client-telegram" className="text-sm font-medium">
                Telegram ID
              </label>
              <Input
                id="client-telegram"
                type="number"
                step="1"
                min="1"
                placeholder="Опционально"
                value={telegramId}
                onChange={(e) => setTelegramId(e.target.value)}
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
                  {Object.entries(LANGUAGE_LABELS).map(([code, label]) => (
                    <SelectItem key={code} value={code}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <label id="label-timezone" className="text-sm font-medium">
                Часовой пояс
              </label>
              <Select
                value={timezone}
                onValueChange={(v) => v && setTimezone(v)}
              >
                <SelectTrigger
                  className="w-full"
                  aria-labelledby="label-timezone"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <label id="label-payment" className="text-sm font-medium">
                Статус оплаты
              </label>
              <Select
                value={paymentStatus}
                onValueChange={(v) => v && setPaymentStatus(v)}
              >
                <SelectTrigger
                  className="w-full"
                  aria-labelledby="label-payment"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Ожидает</SelectItem>
                  <SelectItem value="paid">Оплачено</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Отмена
            </DialogClose>
            <Button type="submit" disabled={!canSubmit}>
              {loading ? "Сохранение..." : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
