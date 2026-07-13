"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  getProgramStatus,
  STATUS_LABELS,
  STATUS_VARIANTS,
} from "@/lib/programs";
import {
  getParsedContent,
  hasContent,
  type ProgramRow,
} from "@/lib/program-utils";
import { ProgramWeekPreview } from "./program-week-preview";
import { toggleProgramStatus, getAssignableClients, assignToClient } from "../actions";
import { Loader2 } from "lucide-react";

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

const TYPE_LABELS: Record<string, string> = {
  template: "Шаблон",
  personal: "Персональная",
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
  const hasProgramContent = hasContent(program);

  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const [showAssign, setShowAssign] = useState(false);
  const [loadingClients, setLoadingClients] = useState(false);
  const [clients, setClients] = useState<Array<{ id: string; name: string; program_id: string | null }>>([]);
  const [selectedClient, setSelectedClient] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleToggle = useCallback(async () => {
    if (program.active) {
      const confirmed = window.confirm(
        `Деактивировать программу "${program.title}"?\n\nКлиенты с этой программой продолжат видеть её, но новые назначения будут невозможны.`,
      );
      if (!confirmed) return;
    }

    setToggling(true);
    setToggleError(null);
    setSuccessMsg(null);
    try {
      const result = await toggleProgramStatus(program.id, !program.active);
      if (result.error) {
        setToggleError(result.error);
      } else {
        setSuccessMsg(program.active ? "Программа деактивирована" : "Программа опубликована");
      }
    } catch {
      setToggleError("Произошла ошибка");
    } finally {
      setToggling(false);
    }
  }, [program.id, program.active, program.title]);

  const handleOpenAssign = useCallback(async () => {
    setAssignError(null);
    setLoadingClients(true);
    try {
      const result = await getAssignableClients();
      if (result.error) {
        setAssignError(result.error);
        return;
      }
      setClients(result.clients);
      setShowAssign(true);
    } catch {
      setAssignError("Произошла ошибка");
    } finally {
      setLoadingClients(false);
    }
  }, []);

  const handleAssign = useCallback(async () => {
    if (!selectedClient) return;
    setAssigning(true);
    setAssignError(null);
    setSuccessMsg(null);
    try {
      const result = await assignToClient(program.id, selectedClient);
      if (result.error) {
        setAssignError(result.error);
        return;
      }
      setSuccessMsg("Программа назначена клиенту");
      setShowAssign(false);
      setSelectedClient("");
      setClients([]);
    } catch {
      setAssignError("Произошла ошибка");
    } finally {
      setAssigning(false);
    }
  }, [program.id, selectedClient]);

  useEffect(() => {
    if (!successMsg) return;
    const t = setTimeout(() => setSuccessMsg(null), 4000);
    return () => clearTimeout(t);
  }, [successMsg]);

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

      {!hasProgramContent && (
        <Alert role="alert" variant={status === "active" ? "destructive" : "default"}>
          <AlertTitle>Содержимое не загружено</AlertTitle>
          <AlertDescription>
            Назначить программу клиенту нельзя — добавьте содержимое программы
          </AlertDescription>
        </Alert>
      )}

      {toggleError && (
        <Alert role="alert" variant="destructive">
          <AlertTitle>Ошибка</AlertTitle>
          <AlertDescription>{toggleError}</AlertDescription>
        </Alert>
      )}

      {assignError && (
        <Alert role="alert" variant="destructive">
          <AlertTitle>Ошибка назначения</AlertTitle>
          <AlertDescription>{assignError}</AlertDescription>
        </Alert>
      )}

      {successMsg && (
        <Alert role="alert" variant="default" className="border-green-500 bg-green-50 text-green-800">
          <AlertDescription>{successMsg}</AlertDescription>
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
            {program.type && <InfoRow label="Тип" value={TYPE_LABELS[program.type] ?? program.type} />}
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
              label="Содержимое"
              value={hasProgramContent ? "Загружено" : "Не загружено"}
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

        {status === "active" ? (
          <Button
            type="button"
            variant="destructive"
            onClick={handleToggle}
            disabled={toggling}
          >
            {toggling ? "Деактивация..." : "Деактивировать"}
          </Button>
        ) : (
          <Button
            type="button"
            variant="default"
            onClick={handleToggle}
            disabled={toggling || !hasProgramContent}
            title={!hasProgramContent ? "Добавьте содержимое перед публикацией" : undefined}
          >
            {toggling ? "Публикация..." : "Опубликовать"}
          </Button>
        )}

        {!showAssign ? (
          <Button
            type="button"
            variant="outline"
            disabled={loadingClients || !hasProgramContent || !program.active}
            title={
              !hasProgramContent
                ? "Добавьте содержимое перед назначением"
                : !program.active
                  ? "Опубликуйте программу перед назначением"
                  : undefined
            }
            onClick={handleOpenAssign}
          >
            {loadingClients ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                Загрузка...
              </>
            ) : (
              "Назначить клиенту"
            )}
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Select value={selectedClient} onValueChange={(v) => setSelectedClient(v ?? "")}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Выберите клиента" />
              </SelectTrigger>
              <SelectContent>
                {clients.length === 0 ? (
                  <SelectItem value="__none__" disabled>
                    Нет клиентов
                  </SelectItem>
                ) : (
                  clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.program_id ? " —есть программа" : ""}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              onClick={handleAssign}
              disabled={!selectedClient || assigning}
            >
              {assigning ? "Сохранение..." : "Сохранить"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowAssign(false);
                setSelectedClient("");
                setClients([]);
              }}
            >
              Отмена
            </Button>
          </div>
        )}
      </div>

      <Separator />

      <ProgramWeekPreview parsed={parsed} />
    </div>
  );
}
