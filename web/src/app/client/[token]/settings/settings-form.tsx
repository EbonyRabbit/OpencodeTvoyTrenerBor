"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Check } from "lucide-react";
import { updateClientSettings, type ClientSettingsInput } from "../actions";
import { TIMEZONE_LIST, LANGUAGE_LABELS, MEASUREMENT_DAY_OPTIONS, CHECKIN_DAY_OPTIONS, WEEKDAY_OPTIONS } from "@/lib/clients";
import type { ClientRow } from "@/lib/clients";

type SettingsClient = Pick<
  ClientRow,
  | "language"
  | "timezone"
  | "morning_time"
  | "measurement_time"
  | "measurement_day"
  | "checkin_day"
  | "checkin_time"
  | "training_days"
>;

export function SettingsForm({
  client,
  programDayOrders,
}: {
  client: SettingsClient;
  programDayOrders: number[];
}) {
  const router = useRouter();
  const [language, setLanguage] = useState(client.language);
  const [timezone, setTimezone] = useState(client.timezone ?? "");
  const [morningTime, setMorningTime] = useState((client.morning_time ?? "").slice(0, 5));
  const [measurementTime, setMeasurementTime] = useState((client.measurement_time ?? "").slice(0, 5));
  const [measurementDay, setMeasurementDay] = useState(
    client.measurement_day != null ? String(client.measurement_day) : "",
  );
  const [checkinDay, setCheckinDay] = useState(
    client.checkin_day != null ? String(client.checkin_day) : "",
  );
  const [checkinTime, setCheckinTime] = useState((client.checkin_time ?? "").slice(0, 5));
  const [trainingDays, setTrainingDays] = useState<(number | null)[]>(
    programDayOrders.map((_, i) => client.training_days?.[i] ?? null),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLanguage(client.language);
    setTimezone(client.timezone ?? "");
    setMorningTime((client.morning_time ?? "").slice(0, 5));
    setMeasurementTime((client.measurement_time ?? "").slice(0, 5));
    setMeasurementDay(
      client.measurement_day != null ? String(client.measurement_day) : "",
    );
    setCheckinDay(client.checkin_day != null ? String(client.checkin_day) : "");
    setCheckinTime((client.checkin_time ?? "").slice(0, 5));
    setTrainingDays(
      programDayOrders.map((_, i) => client.training_days?.[i] ?? null),
    );
  }, [client, programDayOrders]);

  const updateTrainingDay = useCallback(
    (index: number, value: number | null) => {
      setTrainingDays((prev) => {
        const next = [...prev];
        const prevValue = next[index];
        next[index] = value;

        if (prevValue != null && value != null && prevValue !== value) {
          for (let i = 0; i < next.length; i++) {
            if (i !== index && next[i] === value) next[i] = null;
          }
        }
        return next;
      });
    },
    [],
  );

  const hasSchedule = programDayOrders.length > 0;
  const scheduleComplete = hasSchedule && trainingDays.every((d) => d != null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);

    try {
      const data: ClientSettingsInput = {
        language,
        timezone: timezone || null,
        morning_time: morningTime || null,
        measurement_time: measurementTime || null,
        measurement_day: measurementDay ? Number(measurementDay) : null,
        checkin_day: checkinDay ? Number(checkinDay) : null,
        checkin_time: checkinTime || null,
        training_days: scheduleComplete ? trainingDays.map((d) => d as number) : null,
      };

      const result = await updateClientSettings(data);
      if (result.error) {
        setError(result.error);
      } else {
        setSaved(true);
        router.refresh();
      }
    } catch (e) {
      console.error("[settings] Save failed:", e);
      setError("Произошла ошибка");
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <Card>
        <CardContent className="py-8 text-center" aria-live="polite">
          <Check className="mx-auto mb-2 h-8 w-8 text-green-600" />
          <p className="text-lg font-semibold">Настройки сохранены!</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => setSaved(false)}
          >
            Продолжить редактирование
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSave} aria-label="Настройки клиента" className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Уведомления и язык</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="settings-language" className="text-xs text-muted-foreground">
              Язык
            </label>
            <Select value={language} onValueChange={(v) => v && setLanguage(v)}>
              <SelectTrigger id="settings-language" className="w-full" aria-required="true">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(LANGUAGE_LABELS).map(([code, label]) => (
                  <SelectItem key={code} value={code}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label htmlFor="settings-timezone" className="text-xs text-muted-foreground">
              Часовой пояс
            </label>
            <Select value={timezone} onValueChange={(v) => setTimezone(v ?? "")}>
              <SelectTrigger id="settings-timezone" className="w-full">
                <SelectValue placeholder="Не задан" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Не задан</SelectItem>
                {TIMEZONE_LIST.map((tz) => (
                  <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label htmlFor="settings-morning" className="text-xs text-muted-foreground">
              Утреннее напоминание (HH:MM)
            </label>
            <Input
              id="settings-morning"
              type="time"
              value={morningTime}
              onChange={(e) => setMorningTime(e.target.value)}
              className="h-9"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="settings-meas-day" className="text-xs text-muted-foreground">
              День замеров
            </label>
            <Select value={measurementDay} onValueChange={(v) => setMeasurementDay(v ?? "")}>
              <SelectTrigger id="settings-meas-day" className="w-full">
                <SelectValue placeholder="Не задан" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Не задан</SelectItem>
                {MEASUREMENT_DAY_OPTIONS.map(({ value, label }) => (
                  <SelectItem key={value} value={String(value)}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label htmlFor="settings-meas-time" className="text-xs text-muted-foreground">
              Время замеров (HH:MM)
            </label>
            <Input
              id="settings-meas-time"
              type="time"
              value={measurementTime}
              onChange={(e) => setMeasurementTime(e.target.value)}
              className="h-9"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="settings-checkin-day" className="text-xs text-muted-foreground">
              Чек-ин — день недели
            </label>
            <Select value={checkinDay} onValueChange={(v) => setCheckinDay(v ?? "")}>
              <SelectTrigger id="settings-checkin-day" className="w-full">
                <SelectValue placeholder="Не задан" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Не задан</SelectItem>
                {CHECKIN_DAY_OPTIONS.map(({ value, label }) => (
                  <SelectItem key={value} value={String(value)}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label htmlFor="settings-checkin-time" className="text-xs text-muted-foreground">
              Чек-ин — время (HH:MM)
            </label>
            <Input
              id="settings-checkin-time"
              type="time"
              value={checkinTime}
              onChange={(e) => setCheckinTime(e.target.value)}
              className="h-9"
            />
          </div>
        </CardContent>
      </Card>

      {hasSchedule && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Расписание тренировок</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Выбери день недели для каждой тренировки. Расписание применяется ко всем
              неделям программы.
            </p>
            {programDayOrders.map((order, i) => (
              <div key={order} className="grid grid-cols-[100px_1fr] items-center gap-3">
                <span className="text-sm">День {order}</span>
                <Select
                  value={trainingDays[i] != null ? String(trainingDays[i]) : ""}
                  onValueChange={(v) => updateTrainingDay(i, v ? Number(v) : null)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Выбери день" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Не выбран</SelectItem>
                    {WEEKDAY_OPTIONS.map(({ value, label }) => {
                      const taken = trainingDays.some(
                        (d, di) => di !== i && d === value,
                      );
                      return (
                        <SelectItem key={value} value={String(value)} disabled={taken}>
                          {label}{taken ? " (занят)" : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            ))}
            {scheduleComplete && (
              <p className="text-xs text-green-600">
                ✓ Расписание заполнено
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      <Button type="submit" disabled={saving} className="w-full">
        {saving ? (
          <>
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            Сохранение...
          </>
        ) : (
          "Сохранить настройки"
        )}
      </Button>
    </form>
  );
}
