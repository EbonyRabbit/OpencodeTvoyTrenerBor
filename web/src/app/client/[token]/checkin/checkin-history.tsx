"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Database } from "@/types/supabase";

type CheckinRow = Database["public"]["Tables"]["checkins"]["Row"];

function formatDate(date: string | null): string {
  if (!date) return "—";
  try {
    const d = new Date(date + "T00:00:00");
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
    });
  } catch {
    return "—";
  }
}

function ScoreBadge({ value, max = 10, inverted = false }: { value: number | null; max?: number; inverted?: boolean }) {
  if (value == null) return <span className="text-xs text-muted-foreground">—</span>;
  const effectivePct = inverted ? ((max - value) / max) * 100 : (value / max) * 100;
  let variant: "default" | "secondary" | "destructive" = "default";
  if (effectivePct <= 30) variant = "destructive";
  else if (effectivePct <= 60) variant = "secondary";
  return <Badge variant={variant}>{value}/{max}</Badge>;
}

function AdherenceBadge({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-muted-foreground">—</span>;
  let variant: "default" | "secondary" | "destructive" = "default";
  if (value < 50) variant = "destructive";
  else if (value < 80) variant = "secondary";
  return <Badge variant={variant}>{value}%</Badge>;
}

export function CheckinHistory({ checkins }: { checkins: CheckinRow[] }) {
  if (checkins.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">История чек-инов</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Вы ещё не проходили чек-ин
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">История чек-инов</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {checkins.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between rounded-lg border p-3"
          >
            <div className="flex items-center gap-4 text-sm">
              <span className="font-medium">{formatDate(c.date)}</span>
              <div className="flex items-center gap-3 text-muted-foreground">
                <span title="Самочувствие">
                  🧠 <ScoreBadge value={c.wellbeing} />
                </span>
                <span title="Сон">
                  😴 {c.sleep != null ? <Badge variant="outline">{c.sleep}ч</Badge> : <span className="text-xs">—</span>}
                </span>
                <span title="Стресс">
                  ⚡ <ScoreBadge value={c.stress} inverted />
                </span>
                <span title="Придержание питания">
                  🍽 <AdherenceBadge value={c.nutrition_adherence} />
                </span>
                <span title="Пропущено тренировок">
                  🏋️ {c.missed_workouts != null ? <Badge variant={c.missed_workouts > 0 ? "destructive" : "outline"}>{c.missed_workouts}</Badge> : <span className="text-xs">—</span>}
                </span>
              </div>
            </div>
            {(c.complaints || c.comment) && (
              <div className="text-xs text-muted-foreground max-w-[200px] truncate" title={c.complaints && c.comment ? `Жалобы: ${c.complaints}\nКомментарий: ${c.comment}` : c.complaints || c.comment || ""}>
                {c.complaints && <span>⚠️ {c.complaints}</span>}
                {c.complaints && c.comment && <span className="mx-1">·</span>}
                {c.comment && <span>💬 {c.comment}</span>}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
