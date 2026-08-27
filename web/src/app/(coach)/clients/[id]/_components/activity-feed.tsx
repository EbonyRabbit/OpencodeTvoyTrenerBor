"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ACTIVITY_PAGE_SIZE, type ActivityEvent } from "../activity-types";

function formatEventDate(raw: string): string {
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return raw;
  }
}

const TYPE_LABELS: Record<ActivityEvent["event_type"], string> = {
  workout: "Тренировка",
  checkin: "Чек-ин",
  measurement: "Замеры",
  // photo: "Фото", // DISABLED: photo storage removed
  message: "Сообщение",
  notification: "Уведомление",
};

const TYPE_ICONS: Record<ActivityEvent["event_type"], string> = {
  workout: "\uD83C\uDFCB",
  checkin: "\uD83D\uDCCB",
  measurement: "\uD83D\uDCCF",
  // photo: "\uD83D\uDCF8", // DISABLED: photo storage removed
  message: "\uD83D\uDCAC",
  notification: "\uD83D\uDD14",
};

function formatExercise({ sets, reps }: { sets: unknown; reps: unknown }): string {
  if (sets == null) return "";
  const s = String(sets);
  const r = reps != null ? `×${String(reps)}` : "";
  return `: ${s}${r}`;
}

function EventContent({ event }: { event: ActivityEvent }) {
  const d = event.details;

  switch (event.event_type) {
    case "workout": {
      const exercise = String(d.exercise ?? "");
      return <span>{exercise}{formatExercise({ sets: d.sets, reps: d.reps })}</span>;
    }
    case "checkin": {
      const wb = String(d.wellbeing ?? "—");
      const sl = String(d.sleep ?? "—");
      const st = String(d.stress ?? "—");
      return <span>Самочувствие: {wb}/10, Сон: {sl}/10, Стресс: {st}/10</span>;
    }
    case "measurement": {
      const parts: string[] = [];
      if (d.weight != null) parts.push(`Вес: ${String(d.weight)} кг`);
      if (d.waist != null) parts.push(`Талия: ${String(d.waist)} см`);
      if (d.chest != null) parts.push(`Грудь: ${String(d.chest)} см`);
      return <span>{parts.join(", ") || "Замеры"}</span>;
    }
    // case "photo": { // DISABLED: photo storage removed
    //   const labels: Record<string, string> = { front: "Фронтальное", side: "Боковое", back: "Заднее" };
    //   return <span>{labels[String(d.type ?? "")] ?? "Фото"}</span>;
    // }
    case "message": {
      const dir = d.direction === "to_client" ? "\u2192" : "\u2190";
      const preview = String(d.preview ?? "").slice(0, 80);
      return <span>{dir} {preview}{preview.length >= 80 ? "..." : ""}</span>;
    }
    case "notification": {
      const ntLabels: Record<string, string> = {
        morning: "Утро", evening: "Вечер", measurement: "Замеры",
        checkin: "Чек-ин", alert: "Оповещение", payment: "Платёж",
      };
      return <span>{ntLabels[String(d.type ?? "")] ?? String(d.type ?? "")} — {String(d.status ?? "")}</span>;
    }
    default:
      return null;
  }
}

export function ActivityFeed({
  initialEvents,
  loadMore,
}: {
  initialEvents: ActivityEvent[];
  loadMore: (offset: number) => Promise<ActivityEvent[] | { error: string }>;
}) {
  const [events, setEvents] = useState(initialEvents);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialEvents.length >= ACTIVITY_PAGE_SIZE);

  if (events.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            История действий
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            История действий пуста. Данные появятся, когда клиент начнёт тренироваться.
          </p>
        </CardContent>
      </Card>
    );
  }

  async function handleLoadMore() {
    setLoading(true);
    try {
      const res = await loadMore(events.length);
      if ("error" in res) {
        setHasMore(false);
        return;
      }
      const newEvents = res;
      if (newEvents.length < ACTIVITY_PAGE_SIZE) setHasMore(false);
      setEvents((prev) => [...prev, ...newEvents]);
    } catch {
      setHasMore(false);
    }
    setLoading(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          История действий
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-0">
          {events.map((event, i) => (
            <div key={`${event.event_type}_${event.id}`}>
              <div className="flex gap-3 py-2.5 text-sm">
                <span className="text-lg">{TYPE_ICONS[event.event_type]}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-muted-foreground text-xs">
                      {TYPE_LABELS[event.event_type]}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatEventDate(event.date)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-muted-foreground truncate">
                    <EventContent event={event} />
                  </p>
                </div>
              </div>
              {i < events.length - 1 && <Separator />}
            </div>
          ))}
        </div>
        {hasMore && (
          <Button
            type="button"
            variant="outline"
            className="mt-4 w-full"
            onClick={handleLoadMore}
            disabled={loading}
          >
            {loading ? "Загрузка..." : "Показать ещё"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
