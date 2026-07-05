"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getActivePrograms,
  activateProgram,
  generateConnectCode,
  disableClient,
  markPurchased,
} from "../actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  currentProgramId,
}: {
  clientId: string;
  currentCode: string | null;
  currentStatus: string;
  currentProgramId?: string | null;
}) {
  const router = useRouter();
  const [activating, setActivating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [loadingPrograms, setLoadingPrograms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [showProgramSelect, setShowProgramSelect] = useState(false);
  const [selectedProgram, setSelectedProgram] = useState<string>("");
  const [newCode, setNewCode] = useState<string | null>(null);

  const [showPurchaseDialog, setShowPurchaseDialog] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [purchaseSuccess, setPurchaseSuccess] = useState<{
    connectCode?: string;
  } | null>(null);

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
        if (result.error.includes("Программа назначена")) {
          router.refresh();
        }
        setError(result.error);
        return;
      }
      setShowProgramSelect(false);
      setSelectedProgram("");
      setPrograms([]);
      router.refresh();
    } catch {
      setError("Произошла ошибка");
    } finally {
      setActivating(false);
    }
  }, [clientId, selectedProgram, router]);

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
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    } catch {
      setError("Произошла ошибка");
    } finally {
      setDisabling(false);
    }
  }, [clientId, router]);

  const openPurchaseDialog = useCallback(async () => {
    setError(null);
    setPurchaseSuccess(null);
    setSelectedProgram("");
    setShowPurchaseDialog(true);

    if (currentProgramId) return;

    setPrograms([]);
    setLoadingPrograms(true);
    try {
      const list = await getActivePrograms();
      setPrograms(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки программ");
    } finally {
      setLoadingPrograms(false);
    }
  }, [currentProgramId]);

  const handleConfirmPurchase = useCallback(async () => {
    if (!selectedProgram) return;
    setConfirming(true);
    setError(null);
    try {
      const result = await markPurchased(clientId, selectedProgram);
      if (result.error) {
        setError(result.error);
        return;
      }
      setPurchaseSuccess({ connectCode: result.connectCode });
      router.refresh();
    } catch {
      setError("Произошла ошибка");
    } finally {
      setConfirming(false);
    }
  }, [clientId, selectedProgram, router]);

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
          onClick={openPurchaseDialog}
        >
          Подтвердить покупку
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

      {error && !showPurchaseDialog && (
        <p className="text-sm text-destructive" role="alert">{error}</p>
      )}

      <Dialog
        open={showPurchaseDialog}
        onOpenChange={(open) => {
          setShowPurchaseDialog(open);
          if (!open) {
            setPurchaseSuccess(null);
            setError(null);
            setSelectedProgram("");
          }
        }}
      >
        <DialogContent>
          {purchaseSuccess ? (
            <>
              <DialogHeader>
                <DialogTitle>Покупка подтверждена</DialogTitle>
                <DialogDescription>
                  Программа назначена, клиент уведомлён в Telegram.
                </DialogDescription>
              </DialogHeader>
              {purchaseSuccess.connectCode && (
                <div className="rounded-md bg-muted p-3">
                  <p className="text-sm text-muted-foreground">
                    Код подключения для клиента:
                  </p>
                  <p className="font-mono text-lg font-bold">
                    {purchaseSuccess.connectCode}
                  </p>
                </div>
              )}
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  Закрыть
                </DialogClose>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Подтвердить покупку</DialogTitle>
                <DialogDescription>
                  {currentProgramId
                    ? "У клиента уже есть активная программа. Сначала отключите текущую."
                    : "Выберите программу для назначения клиенту."}
                </DialogDescription>
              </DialogHeader>
              {error && (
                <p className="text-sm text-destructive" role="alert">{error}</p>
              )}
              {!currentProgramId && (
                <>
                  {loadingPrograms ? (
                    <p className="text-sm text-muted-foreground">Загрузка...</p>
                  ) : programs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Нет доступных программ
                    </p>
                  ) : (
                    <Select
                      value={selectedProgram}
                      onValueChange={(v) => v && setSelectedProgram(v)}
                    >
                      <SelectTrigger className="w-full">
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
                </>
              )}
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  Отмена
                </DialogClose>
                {!currentProgramId && programs.length > 0 && (
                  <Button
                    onClick={handleConfirmPurchase}
                    disabled={!selectedProgram || confirming}
                  >
                    {confirming ? "Сохранение..." : "Подтвердить"}
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
