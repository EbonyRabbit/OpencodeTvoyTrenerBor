"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { MiniLineChart } from "../../_components/mini-line-chart";
import { getAdherenceColor } from "@/lib/adherence";
import type { WeekAdherence } from "@/lib/adherence";

function formatDate(date: string | null): string {
  if (!date) return "—";
  try {
    return new Date(date).toLocaleDateString("ru-RU");
  } catch {
    return "—";
  }
}

export function WorkoutView({
  clientId,
  clientName,
  programName,
  weeks,
  overallAdherence,
  totalCompleted,
  totalExpected,
  hasSchedule,
  hasWorkoutLogs,
  hasParsedContent,
}: {
  clientId: string;
  clientName: string;
  programName: string | null;
  weeks: WeekAdherence[];
  overallAdherence: number | null;
  totalCompleted: number;
  totalExpected: number;
  hasSchedule: boolean;
  hasWorkoutLogs: boolean;
  hasParsedContent: boolean;
}) {
  if (!hasSchedule) {
    return (
      <div className="space-y-6" role="status">
        <Link
          href={`/clients/${clientId}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Назад к клиенту
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>Adherence — {clientName}</CardTitle>
            <CardDescription>
              {programName ?? "Нет программы"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              У клиента нет расписания тренировок.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!hasParsedContent) {
    return (
      <div className="space-y-6" role="status">
        <Link
          href={`/clients/${clientId}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Назад к клиенту
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>Adherence — {clientName}</CardTitle>
            <CardDescription>
              {programName ?? "Нет программы"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Данные о программе недоступны. Убедитесь, что программа заполнена и
              содержит расписание по неделям.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!hasWorkoutLogs) {
    return (
      <div className="space-y-6" role="status">
        <Link
          href={`/clients/${clientId}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Назад к клиенту
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>Adherence — {clientName}</CardTitle>
            <CardDescription>
              {programName ?? "Нет программы"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Нет данных о тренировках. Данные появятся после синхронизации
              тренировок из бота.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (weeks.length === 0) {
    return (
      <div className="space-y-6" role="status">
        <Link
          href={`/clients/${clientId}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Назад к клиенту
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>Adherence — {clientName}</CardTitle>
            <CardDescription>
              {programName ?? "Нет программы"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Нет завершённых недель для расчёта adherence. Возможно, программа
              только началась или расписание не соответствует программе.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const chartData = useMemo(
    () =>
      weeks
        .filter((w) => w.adherencePct !== null)
        .map((w) => ({
          label: w.startDate,
          value: w.adherencePct,
        })),
    [weeks],
  );

  return (
    <div className="space-y-6">
      <Link
        href={`/clients/${clientId}`}
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← Назад к клиенту
      </Link>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Card role="region" aria-label="Общий adherence">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Общий adherence
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={`text-3xl font-bold ${getAdherenceColor(overallAdherence)}`}
            >
              {overallAdherence !== null ? `${overallAdherence}%` : "—"}
            </p>
          </CardContent>
        </Card>
        <Card role="region" aria-label="Всего тренировок">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Выполнено
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{totalCompleted}</p>
          </CardContent>
        </Card>
        <Card role="region" aria-label="Запланировано тренировок">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Запланировано
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{totalExpected}</p>
          </CardContent>
        </Card>
        <Card role="region" aria-label="Количество недель">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Недель
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{weeks.length}</p>
          </CardContent>
        </Card>
      </div>

      {chartData.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Динамика adherence по неделям
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MiniLineChart
              data={chartData}
              color="var(--color-chart-2, #16a34a)"
              label="Adherence"
              height={160}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Adherence по неделям</CardTitle>
          <CardDescription>
            {programName ?? "Без программы"}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table aria-label="Adherence по неделям">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Неделя</TableHead>
                <TableHead scope="col">Фокус</TableHead>
                <TableHead scope="col">Даты</TableHead>
                <TableHead scope="col" className="text-center">
                  Запланировано
                </TableHead>
                <TableHead scope="col" className="text-center">
                  Выполнено
                </TableHead>
                <TableHead scope="col" className="text-center">
                  Adherence
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {weeks.map((week) => (
                <TableRow key={week.weekNumber}>
                  <TableCell className="font-medium">
                    {week.weekLabel}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {week.focus ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {formatDate(week.startDate)}
                    {" — "}
                    {formatDate(week.endDate)}
                  </TableCell>
                  <TableCell className="text-center">{week.expected}</TableCell>
                  <TableCell className="text-center">{week.completed}</TableCell>
                  <TableCell className="text-center">
                    <span
                      className={`font-bold ${getAdherenceColor(week.adherencePct)}`}
                    >
                      {week.adherencePct}%
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
