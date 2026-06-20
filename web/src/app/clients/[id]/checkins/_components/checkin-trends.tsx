"use client";

import { MiniLineChart } from "../../_components/mini-line-chart";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

type DataPoint = { date: string; wellbeing: number | null; sleep: number | null; stress: number | null; nutrition_adherence: number | null };

export function CheckinTrends({ data }: { data: DataPoint[] }) {
  if (data.length < 2) return null;

  const chartData = (metric: keyof Pick<DataPoint, "wellbeing" | "sleep" | "stress" | "nutrition_adherence">) =>
    data.map((d) => ({ label: d.date, value: d[metric] }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Динамика показателей
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">
              Самочувствие (1–10)
            </h3>
            <MiniLineChart
              data={chartData("wellbeing")}
              color="var(--color-chart-2, #16a34a)"
              label="Самочувствие"
            />
          </div>
          <div>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">
              Сон (1–10)
            </h3>
            <MiniLineChart
              data={chartData("sleep")}
              color="var(--color-primary, #2563eb)"
              label="Сон"
            />
          </div>
          <div>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">
              Стресс (1–10)
            </h3>
            <MiniLineChart
              data={chartData("stress")}
              color="var(--color-chart-3, #dc2626)"
              label="Стресс"
            />
          </div>
          <div>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">
              Питание (0–100%)
            </h3>
            <MiniLineChart
              data={chartData("nutrition_adherence")}
              color="#f59e0b"
              label="Питание"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
