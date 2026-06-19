"use client";

import { useCallback, useState } from "react";
import {
  getActivePrograms,
  activateProgram,
  generateConnectCode,
  disableClient,
  togglePayment,
} from "../actions";
import { Button } from "@/components/ui/button";
import type { PaymentStatus } from "@/types/supabase";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Program = { id: string; title: string };

export function ClientActions({
  clientId,
  currentCode,
  currentStatus,
  currentPaymentStatus,
}: {
  clientId: string;
  currentCode: string | null;
  currentStatus: string;
  currentPaymentStatus: PaymentStatus;
}) {
  const [activating, setActivating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [loadingPrograms, setLoadingPrograms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [showProgramSelect, setShowProgramSelect] = useState(false);
  const [selectedProgram, setSelectedProgram] = useState<string>("");
  const [newCode, setNewCode] = useState<string | null>(null);

  const loadPrograms = useCallback(async () => {
    setError(null);
    setLoadingPrograms(true);
    try {
      const list = await getActivePrograms();
      setPrograms(list);
      setShowProgramSelect(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки программ");
    } finally {
      setLoadingPrograms(false);
    }
  }, []);

  const handleActivate = useCallback(async () => {
    if (!selectedProgram) return;
    setActivating(true);
    setError(null);
    try {
      const result = await activateProgram(clientId, selectedProgram);
      if (result.error) {
        setError(result.error);
        return;
      }
      setShowProgramSelect(false);
      setSelectedProgram("");
      setPrograms([]);
    } catch {
      setError("Произошла ошибка");
    } finally {
      setActivating(false);
    }
  }, [clientId, selectedProgram]);

  const handleGenerateCode = useCallback(async () => {
    if (currentCode && !confirm("Сгенерировать новый код подключения?")) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await generateConnectCode(clientId);
      if (result.error) setError(result.error);
      if (result.code) setNewCode(result.code);
    } catch {
      setError("Произошла ошибка");
    } finally {
      setGenerating(false);
    }
  }, [clientId, currentCode]);

  const handleDisable = useCallback(async () => {
    if (!confirm("Отключить клиента? Доступ будет заблокирован.")) return;
    setDisabling(true);
    setError(null);
    try {
      const result = await disableClient(clientId);
      if (result.error) setError(result.error);
    } catch {
      setError("Произошла ошибка");
    } finally {
      setDisabling(false);
    }
  }, [clientId]);

  const handleTogglePayment = useCallback(async () => {
    const verb =
      currentPaymentStatus === "paid"
        ? "Отметить неоплаченным?"
        : "Отметить оплаченным?";
    if (!confirm(verb)) return;
    setToggling(true);
    setError(null);
    try {
      const result = await togglePayment(clientId, currentPaymentStatus);
      if (result.error) setError(result.error);
    } catch {
      setError("Произошла ошибка");
    } finally {
      setToggling(false);
    }
  }, [clientId, currentPaymentStatus]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" disabled>
          Редактировать
        </Button>

        {!showProgramSelect ? (
          <Button
            type="button"
            variant="outline"
            onClick={loadPrograms}
            disabled={loadingPrograms}
          >
            {loadingPrograms ? "Загрузка..." : "Активировать программу"}
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            {programs.length === 0 ? (
              <span className="text-sm text-muted-foreground">
                Нет активных программ
              </span>
            ) : (
              <Select
                value={selectedProgram}
                onValueChange={(v) => v && setSelectedProgram(v)}
              >
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Выберите программу" />
                </SelectTrigger>
                <SelectContent>
                  {programs.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {programs.length > 0 && (
              <Button
                type="button"
                size="sm"
                onClick={handleActivate}
                disabled={!selectedProgram || activating}
              >
                {activating ? "Сохранение..." : "Сохранить"}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowProgramSelect(false);
                setSelectedProgram("");
                setPrograms([]);
              }}
            >
              Отмена
            </Button>
          </div>
        )}

        <Button
          type="button"
          variant="outline"
          onClick={handleGenerateCode}
          disabled={generating}
        >
          {generating ? "Генерация..." : "Код подключения"}
        </Button>

        {currentStatus !== "inactive" && currentStatus !== "access_expired" && (
          <Button
            type="button"
            variant="destructive"
            onClick={handleDisable}
            disabled={disabling}
          >
            {disabling ? "Отключение..." : "Отключить клиента"}
          </Button>
        )}

        <Button
          type="button"
          variant="outline"
          onClick={handleTogglePayment}
          disabled={toggling}
        >
          {toggling
            ? "Сохранение..."
            : currentPaymentStatus === "paid"
              ? "Отметить неоплаченным"
              : "Отметить оплаченным"}
        </Button>
      </div>

      {currentCode && (
        <p className="text-sm text-muted-foreground">
          Код подключения:{" "}
          <span className="font-mono font-medium text-foreground">
            {currentCode}
          </span>
        </p>
      )}
      {newCode && (
        <p className="text-sm text-muted-foreground">
          Новый код:{" "}
          <span className="font-mono font-medium text-foreground">
            {newCode}
          </span>
        </p>
      )}

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}
