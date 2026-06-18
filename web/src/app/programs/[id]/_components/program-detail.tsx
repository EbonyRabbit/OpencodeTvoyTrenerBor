"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  getProgramStatus,
  STATUS_LABELS,
  STATUS_VARIANTS,
} from "@/lib/programs";
import {
  getParsedContent,
  hasTemplate,
  type ProgramRow,
} from "@/lib/program-utils";
import { ProgramWeekPreview } from "./program-week-preview";

function formatPrice(price: number | null): string {
  if (price === null) return "По запросу";
  return `${price.toLocaleString("ru-RU")} ₽`;
}

function formatDate(date: string): string {
  try {
    return new Date(date).toLocaleDateString("ru-RU");
  } catch {
    return "—";
  }
}

const LANGUAGE_LABELS: Record<string, string> = {
  ru: "Русский",
  en: "English",
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function ProgramDetail({
  program,
  clientCount,
}: {
  program: ProgramRow;
  clientCount: number;
}) {
  const status = getProgramStatus(program);
  const parsed = getParsedContent(program);
  const hasExcel = hasTemplate(program);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href="/programs"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← Назад к программам
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="break-words min-w-0">
          <h1 className="text-2xl font-bold">{program.title}</h1>
          {program.description && (
            <p className="mt-2 text-muted-foreground">{program.description}</p>
          )}
        </div>
        <Badge variant={STATUS_VARIANTS[status]} className="shrink-0">
          {STATUS_LABELS[status]}
        </Badge>
      </div>

      {!hasExcel && (
        <Alert role="alert" variant={status === "active" ? "destructive" : "default"}>
          <AlertTitle>Шаблон не загружен</AlertTitle>
          <AlertDescription>
            Назначить программу клиенту нельзя — требуется загрузить шаблон .xlsx
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Информация
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <InfoRow label="Цена" value={formatPrice(program.price)} />
            <InfoRow label="Длительность" value={`${program.duration_weeks} нед.`} />
            {program.language && (
              <InfoRow
                label="Язык"
                value={LANGUAGE_LABELS[program.language] ?? program.language}
              />
            )}
            {program.type && <InfoRow label="Тип" value={program.type} />}
            {program.equipment && <InfoRow label="Инвентарь" value={program.equipment} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Статистика
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <InfoRow label="Клиентов" value={String(clientCount)} />
            <InfoRow label="Создана" value={formatDate(program.created_at)} />
            <InfoRow label="Обновлена" value={formatDate(program.updated_at)} />
            <InfoRow
              label="Шаблон"
              value={hasExcel ? "Загружен" : "Не загружен"}
            />
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-3">
        {status !== "active" && (
          <Link
            href={`/programs/${program.id}/edit`}
            className={buttonVariants({ variant: "outline" })}
          >
            Редактировать
          </Link>
        )}
        <Button
          type="button"
          disabled={!hasExcel}
          title={!hasExcel ? "Загрузите шаблон перед назначением" : undefined}
        >
          Назначить клиенту
        </Button>
      </div>

      <Separator />

      <ProgramWeekPreview parsed={parsed} />
    </div>
  );
}
