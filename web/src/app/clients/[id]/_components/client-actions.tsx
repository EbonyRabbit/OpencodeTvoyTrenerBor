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
  currentProgramId,
  currentCode,
  currentStatus,
  currentPaymentStatus,
}: {
  clientId: string;
  currentProgramId: string | null;
  currentCode: string | null;
  currentStatus: string;
  currentPaymentStatus: string;
}) {
  const [activating, setActivating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [programs, setPrograms] = useState<Program[] | null>(null);
  const [showProgramSelect, setShowProgramSelect] = useState(false);
  const [selectedProgram, setSelectedProgram] = useState<string>("");
  const [newCode, setNewCode] = useState<string | null>(null);

  const loadPrograms = useCallback(async () => {
    if (programs === null) {
      const list = await getActivePrograms();
      setPrograms(list);
    }
    setShowProgramSelect(true);
  }, [programs]);

  const handleActivate = useCallback(async () => {
    if (!selectedProgram) return;
    setActivating(true);
    setError(null);
    const result = await activateProgram(clientId, selectedProgram);
    if (result.error) setError(result.error);
    setActivating(false);
    setShowProgramSelect(false);
  }, [clientId, selectedProgram]);

  const handleGenerateCode = useCallback(async () => {
    if (currentCode && !confirm("Сгенерировать новый код подключения?")) return;
    setGenerating(true);
    setError(null);
    const result = await generateConnectCode(clientId);
    if (result.error) setError(result.error);
    if (result.code) setNewCode(result.code);
    setGenerating(false);
  }, [clientId, currentCode]);

  const handleDisable = useCallback(async () => {
    if (!confirm("Отключить клиента? Доступ будет заблокирован.")) return;
    setDisabling(true);
    setError(null);
    const result = await disableClient(clientId);
    if (result.error) setError(result.error);
    setDisabling(false);
  }, [clientId]);

  const handleTogglePayment = useCallback(async () => {
    setToggling(true);
    setError(null);
    const result = await togglePayment(clientId, currentPaymentStatus);
    if (result.error) setError(result.error);
    setToggling(false);
  }, [clientId, currentPaymentStatus]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" disabled>
          Редактировать
        </Button>

        {!showProgramSelect ? (
          <Button type="button" variant="outline" onClick={loadPrograms}>
            Активировать программу
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Select value={selectedProgram} onValueChange={(v) => v && setSelectedProgram(v)}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Выберите программу" />
              </SelectTrigger>
              <SelectContent>
                {programs !== null && programs.length === 0 && (
                  <SelectItem value="__none__" disabled>
                    Нет активных программ
                  </SelectItem>
                )}
                {programs?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              onClick={handleActivate}
              disabled={!selectedProgram || activating}
            >
              {activating ? "Сохранение..." : "Сохранить"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setShowProgramSelect(false)}
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

        <Button
          type="button"
          variant="destructive"
          onClick={handleDisable}
          disabled={disabling}
        >
          {disabling ? "Отключение..." : "Отключить клиента"}
        </Button>

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
          Код подключения: <span className="font-mono font-medium text-foreground">{currentCode}</span>
        </p>
      )}
      {newCode && (
        <p className="text-sm text-muted-foreground">
          Новый код: <span className="font-mono font-medium text-foreground">{newCode}</span>
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
