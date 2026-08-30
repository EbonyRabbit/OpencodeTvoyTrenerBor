"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  pauseClientPlan,
  resumeClientPlan,
  getActivePause,
  getPauseHistory,
  getSuggestedStrategy,
} from "../pause/actions";
import type { PlanPause, PauseReason, ResumeStrategy } from "@/lib/plan-adjustment";

const REASON_LABELS: Record<PauseReason, string> = {
  sick: "Болезнь",
  vacation: "Отпуск",
  injury: "Травма",
  personal: "Личное",
  other: "Другое",
};

const STRATEGY_LABELS: Record<ResumeStrategy, string> = {
  skip: "Пропустить - просто продолжаем",
  shift: "Сдвиг - все даты сдвигаются вперёд",
  deload: "Разгрузка - неделя облегчённого режима",
  rollback: "Откат - повтор последней завершённой недели",
};

const STRATEGY_DESCRIPTIONS: Record<ResumeStrategy, string> = {
  skip: "Пропущенные дни выпадают, план не сдвигается. Подходит для пауз 1-2 дня.",
  shift: "Все будущие тренировки сдвигаются на длительность паузы. Подходит для пауз 3-5 дней.",
  deload: "После паузы вставляется неделя разгрузки (50% объёма), затем программа продолжается. Подходит для пауз 5-7 дней.",
  rollback: "Возврат к последней полностью выполненной неделе. Подходит для пауз более 7 дней.",
};

function formatDate(date: string | null): string {
  if (!date) return "-";
  try {
    return new Date(date).toLocaleDateString("ru-RU");
  } catch {
    return "-";
  }
}

function formatDuration(start: string, end: string | null): string {
  const endDate = end ?? new Date().toISOString().split("T")[0];
  const days = Math.round(
    (new Date(endDate).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24),
  ) + 1;
  return `${days} дн.`;
}

export function PauseSection({ clientId }: { clientId: string }) {
  const [activePause, setActivePause] = useState<PlanPause | null>(null);
  const [pauses, setPauses] = useState<PlanPause[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showResumeForm, setShowResumeForm] = useState(false);
  const [suggestedStrategy, setSuggestedStrategy] = useState<ResumeStrategy>("skip");
  const [suggestedDuration, setSuggestedDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [newPauseDate, setNewPauseDate] = useState(new Date().toISOString().split("T")[0]);
  const [newPauseEndDate, setNewPauseEndDate] = useState("");
  const [newPauseReason, setNewPauseReason] = useState<PauseReason>("other");
  const [resumeDate, setResumeDate] = useState(new Date().toISOString().split("T")[0]);
  const [resumeStrategy, setResumeStrategy] = useState<ResumeStrategy>("shift");

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(t);
  }, [success]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pauseResult, historyResult, strategyResult] = await Promise.all([
        getActivePause(clientId),
        getPauseHistory(clientId),
        getSuggestedStrategy(clientId),
      ]);
      if (pauseResult.error) setError(pauseResult.error);
      else setActivePause(pauseResult.pause);

      if (historyResult.error) setError(historyResult.error);
      else setPauses(historyResult.pauses);

      if (strategyResult.error) setError(strategyResult.error);
      setSuggestedStrategy(strategyResult.strategy);
      setSuggestedDuration(strategyResult.durationDays);
      setResumeStrategy(strategyResult.strategy);
    } catch {
      setError("Не удалось загрузить данные о паузах");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    const fetchData = async () => {
      await loadData();
    };
    fetchData();
  }, [loadData]);

  const handleCreatePause = async () => {
    setError(null);
    setSuccess(null);
    const result = await pauseClientPlan(clientId, newPauseDate, newPauseReason, newPauseEndDate || null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSuccess("Пауза поставлена");
    setShowCreateForm(false);
    loadData();
  };

  const handleResume = async () => {
    setError(null);
    setSuccess(null);
    const result = await resumeClientPlan(clientId, resumeDate, resumeStrategy);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSuccess("Пауза завершена. Расписание обновлено.");
    setShowResumeForm(false);
    loadData();
  };

  const recentPauses = pauses.filter((p) => p.status === "completed").slice(0, 10);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Паузы в тренировках
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Загрузка...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Паузы в тренировках
          </CardTitle>
          {!activePause && !showCreateForm && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowCreateForm(true)}
            >
              Поставить на паузу
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert role="alert" variant="destructive">
            <AlertTitle>Ошибка</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert role="alert" variant="default" className="border-green-500 bg-green-50 text-green-800">
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}

        {activePause && (
          <Alert role="alert" variant="default" className="border-yellow-500 bg-yellow-50">
            <AlertTitle className="text-amber-800">Активная пауза</AlertTitle>
            <AlertDescription className="space-y-2">
              <div className="text-sm">
                <span className="font-medium">C </span>
                {formatDate(activePause.pause_start)}
                <span className="font-medium">, причина: </span>
                {REASON_LABELS[activePause.reason as PauseReason] ?? activePause.reason}
              </div>
              <div className="text-sm text-amber-700">
                Длительность: {formatDuration(activePause.pause_start, activePause.pause_end)}
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => setShowResumeForm(true)}
                >
                  Возобновить
                </Button>
                {!showResumeForm && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowResumeForm(true)}
                  >
                    Настроить возобновление
                  </Button>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {showResumeForm && activePause && (
          <div className="rounded-lg border p-4 space-y-3">
            <h4 className="text-sm font-medium">Настройки возобновления</h4>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Дата возврата</label>
              <Input
                type="date"
                value={resumeDate}
                onChange={(e) => setResumeDate(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Стратегия</label>
              <p className="text-xs text-muted-foreground mb-2">
                Рекомендуется: <Badge variant="secondary">{STRATEGY_LABELS[suggestedStrategy]}</Badge>
                {" ("}{suggestedDuration}{" дн. паузы)"}
              </p>
              <Select
                value={resumeStrategy}
                onValueChange={(v) => setResumeStrategy(v as ResumeStrategy)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["skip", "shift", "deload", "rollback"] as ResumeStrategy[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {STRATEGY_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {STRATEGY_DESCRIPTIONS[resumeStrategy]}
              </p>
            </div>

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="default" size="sm" onClick={handleResume}>
                Применить
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowResumeForm(false)}
              >
                Отмена
              </Button>
            </div>
          </div>
        )}

        {showCreateForm && !activePause && (
          <div className="rounded-lg border p-4 space-y-3">
            <h4 className="text-sm font-medium">Новая пауза</h4>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Дата начала паузы</label>
              <Input
                type="date"
                value={newPauseDate}
                onChange={(e) => setNewPauseDate(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Дата окончания (необязательно)</label>
              <Input
                type="date"
                value={newPauseEndDate}
                onChange={(e) => setNewPauseEndDate(e.target.value)}
                min={newPauseDate}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Причина</label>
              <Select
                value={newPauseReason}
                onValueChange={(v) => setNewPauseReason(v as PauseReason)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["sick", "vacation", "injury", "personal", "other"] as PauseReason[]).map(
                    (r) => (
                      <SelectItem key={r} value={r}>
                        {REASON_LABELS[r]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="default" size="sm" onClick={handleCreatePause}>
                Поставить на паузу
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowCreateForm(false)}
              >
                Отмена
              </Button>
            </div>
          </div>
        )}

        {recentPauses.length > 0 && (
          <div>
            <h4 className="text-xs text-muted-foreground mb-2">Последние паузы</h4>
            <div className="space-y-1">
              {recentPauses.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between text-sm py-1"
                >
                  <span>
                    {formatDate(p.pause_start)}
                    {p.pause_end ? ` - ${formatDate(p.pause_end)}` : " - ..."}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {REASON_LABELS[p.reason as PauseReason] ?? p.reason}
                    {p.strategy && p.strategy !== "shift" && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        {STRATEGY_LABELS[p.strategy as ResumeStrategy] ?? p.strategy}
                      </Badge>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!activePause && pauses.length === 0 && !showCreateForm && (
          <p className="text-sm text-muted-foreground">
            Пауз не было. Если клиент пропускает тренировки, можно поставить план на паузу и сдвинуть расписание.
          </p>
        )}

        {pauses.length > 0 && (
          <div className="pt-2">
            <Link
              href={`/clients/${clientId}/pause`}
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Все паузы →
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
