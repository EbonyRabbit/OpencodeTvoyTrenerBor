"use client";

import { MiniLineChart } from "../../_components/mini-line-chart";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { Database } from "@/types/supabase";

type MeasurementDataPoint = Pick<
  Database["public"]["Tables"]["measurements"]["Row"],
  "date" | "weight" | "waist" | "abdomen" | "chest" | "hips" | "glutes" | "left_thigh" | "right_thigh" | "left_arm" | "right_arm" | "body_fat" | "muscle_mass" | "visceral_fat"
>;

type MetricDef = {
  key: keyof Omit<MeasurementDataPoint, "date">;
  label: string;
  unit: string;
  color: string;
};

const METRICS: MetricDef[] = [
  { key: "weight", label: "Вес", unit: "кг", color: "var(--color-primary, #2563eb)" },
  { key: "waist", label: "Талия", unit: "см", color: "var(--color-chart-2, #16a34a)" },
  { key: "abdomen", label: "Живот", unit: "см", color: "var(--color-chart-4, #a855f7)" },
  { key: "chest", label: "Грудь", unit: "см", color: "var(--color-chart-3, #dc2626)" },
  { key: "hips", label: "Бёдра", unit: "см", color: "var(--color-chart-6, #f59e0b)" },
  { key: "glutes", label: "Ягодицы", unit: "см", color: "var(--color-chart-5, #ec4899)" },
  { key: "left_thigh", label: "Лев. бедро", unit: "см", color: "var(--color-primary, #2563eb)" },
  { key: "right_thigh", label: "Пр. бедро", unit: "см", color: "var(--color-chart-2, #16a34a)" },
  { key: "left_arm", label: "Лев. рука", unit: "см", color: "var(--color-chart-3, #dc2626)" },
  { key: "right_arm", label: "Пр. рука", unit: "см", color: "var(--color-chart-7, #eab308)" },
  { key: "body_fat", label: "Жир", unit: "%", color: "var(--color-chart-4, #a855f7)" },
  { key: "muscle_mass", label: "Мышеч. масса", unit: "кг", color: "var(--color-chart-5, #ec4899)" },
  { key: "visceral_fat", label: "Висц. жир", unit: "", color: "var(--color-chart-8, #f97316)" },
];

export function MeasurementTrends({ data }: { data: MeasurementDataPoint[] }) {
  if (data.length < 2) return null;

  const hasAnyData = METRICS.some((m) => data.some((d) => d[m.key] !== null));
  if (!hasAnyData) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Динамика замеров
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {METRICS.map((metric) => {
            const chartData = data.map((d) => ({
              label: d.date,
              value: d[metric.key],
            }));

            const hasEnough = chartData.filter((p) => p.value !== null).length >= 2;
            if (!hasEnough) return null;

            return (
              <div key={metric.key}>
                <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                  {metric.label}{metric.unit ? ` (${metric.unit})` : ""}
                </h3>
                <MiniLineChart
                  data={chartData}
                  color={metric.color}
                  label={metric.label}
                />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
