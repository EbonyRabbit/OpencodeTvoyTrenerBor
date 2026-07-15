"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Database } from "@/types/supabase";

type MeasurementRow = Database["public"]["Tables"]["measurements"]["Row"];

function formatDate(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function Delta({
  current,
  prev,
  positiveIsGood,
}: {
  current: number | null;
  prev: number | null;
  positiveIsGood: boolean;
}) {
  if (current === null || prev === null) return null;
  const diff = current - prev;
  if (diff === 0) return null;
  const sign = diff > 0 ? "+" : "";
  const isGood = positiveIsGood ? diff > 0 : diff < 0;
  const cls = isGood ? "text-green-600" : "text-red-600";
  return (
    <span className={`text-xs font-medium ${cls}`}>
      {sign}{diff.toFixed(1)}
    </span>
  );
}

function MeasureItem({
  label,
  value,
  prevValue,
  unit,
  positiveIsGood,
}: {
  label: string;
  value: number | null;
  prevValue: number | null;
  unit: string;
  positiveIsGood: boolean;
}) {
  if (value === null) return null;
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <Delta current={value} prev={prevValue} positiveIsGood={positiveIsGood} />
        <span className="text-sm font-medium tabular-nums">
          {Number.isInteger(value) ? value : value.toFixed(1)}{unit}
        </span>
      </div>
    </div>
  );
}

type MetricItem = {
  key: keyof Omit<MeasurementRow, "id" | "client_id" | "date" | "comment" | "created_at" | "updated_at">;
  label: string;
  unit: string;
  positiveIsGood: boolean;
};

const METRIC_GROUPS: { title: string; items: MetricItem[] }[] = [
  {
    title: "Основные",
    items: [
      { key: "weight", label: "Вес", unit: "кг", positiveIsGood: false },
      { key: "chest", label: "Грудь", unit: "см", positiveIsGood: true },
      { key: "waist", label: "Талия", unit: "см", positiveIsGood: false },
      { key: "abdomen", label: "Живот", unit: "см", positiveIsGood: false },
      { key: "hips", label: "Бёдра", unit: "см", positiveIsGood: false },
      { key: "glutes", label: "Ягодицы", unit: "см", positiveIsGood: true },
    ],
  },
  {
    title: "Конечности",
    items: [
      { key: "left_thigh", label: "Лев. бедро", unit: "см", positiveIsGood: true },
      { key: "right_thigh", label: "Пр. бедро", unit: "см", positiveIsGood: true },
      { key: "left_arm", label: "Лев. рука", unit: "см", positiveIsGood: true },
      { key: "right_arm", label: "Пр. рука", unit: "см", positiveIsGood: true },
    ],
  },
  {
    title: "Состав тела",
    items: [
      { key: "body_fat", label: "Жир", unit: "%", positiveIsGood: false },
      { key: "muscle_mass", label: "Мышцы", unit: "кг", positiveIsGood: true },
      { key: "visceral_fat", label: "Висц. жир", unit: "", positiveIsGood: false },
    ],
  },
];

export function MeasurementHistory({ measurements }: { measurements: MeasurementRow[] }) {
  if (measurements.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">
            У вас пока нет замеров. Заполните форму выше, чтобы начать.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground">
        История замеров
      </h3>
      {measurements.map((m, idx) => {
        const prev = idx < measurements.length - 1 ? measurements[idx + 1] : null;
        const hasAnyData = METRIC_GROUPS.some((g) =>
          g.items.some((item) => m[item.key] !== null),
        );
        if (!hasAnyData) return null;

        return (
          <Card key={m.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                {formatDate(m.date)}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {METRIC_GROUPS.map((group) => {
                const visibleItems = group.items.filter(
                  (item) => m[item.key] !== null,
                );
                if (visibleItems.length === 0) return null;
                return (
                  <div key={group.title}>
                    <p className="mb-1 text-[10px] font-medium uppercase text-muted-foreground/60">
                      {group.title}
                    </p>
                    <div className="space-y-1">
                      {visibleItems.map((item) => (
                        <MeasureItem
                          key={item.key}
                          label={item.label}
                          value={m[item.key]}
                          prevValue={prev?.[item.key] ?? null}
                          unit={item.unit}
                          positiveIsGood={item.positiveIsGood}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
              {m.comment && (
                <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                  {m.comment}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
