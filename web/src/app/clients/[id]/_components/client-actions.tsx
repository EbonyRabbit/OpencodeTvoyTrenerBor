"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getActivePrograms,
  activateProgram,
  generateConnectCode,
  disableClient,
  markPurchased,
  togglePayment,
  updateClient,
} from "../actions";
import { TIMEZONE_LIST, MEASUREMENT_DAY_OPTIONS, LANGUAGE_LABELS } from "@/lib/clients";
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
import { Input } from "@/components/ui/input";
type Program = { id: string; title: string };

export function ClientActions({
  clientId,
  currentCode,
  currentStatus,
  currentProgramId,
  currentPaymentStatus,
  clientName,
  clientLanguage,
  clientTimezone,
  clientMorningTime,
  clientMeasurementTime,
  clientMeasurementDay,
}: {
  clientId: string;
  currentCode: string | null;
  currentStatus: string;
  currentProgramId?: string | null;
  currentPaymentStatus?: string;
  clientName: string;
  clientLanguage: string;
  clientTimezone: string | null;
  clientMorningTime: string | null;
  clientMeasurementTime: string | null;
  clientMeasurementDay: number | null;
}) {
  const router = useRouter();
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

  const [showPurchaseDialog, setShowPurchaseDialog] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [purchaseSuccess, setPurchaseSuccess] = useState<{
    connectCode?: string;
  } | null>(null);

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string;
    language: string;
    timezone: string;
    morning_time: string;
    measurement_time: string;
    measurement_day: string;
  }>({
    name: "",
    language: "ru",
    timezone: "",
    morning_time: "",
    measurement_time: "",
    measurement_day: "",
  });

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

  const handleTogglePayment = useCallback(async () => {
    if (!currentPaymentStatus) return;
    setToggling(true);
    setError(null);
    try {
      const result = await togglePayment(
        clientId,
        currentPaymentStatus as "paid" | "pending",
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    } catch {
      setError("Произошла ошибка");
    } finally {
      setToggling(false);
    }
  }, [clientId, currentPaymentStatus, router]);

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

  const openEditDialog = useCallback(() => {
    setEditError(null);
    setEditForm({
      name: clientName,
      language: clientLanguage,
      timezone: clientTimezone ?? "",
      morning_time: clientMorningTime ?? "",
      measurement_time: clientMeasurementTime ?? "",
      measurement_day: clientMeasurementDay != null ? String(clientMeasurementDay) : "",
    });
    setShowEditDialog(true);
  }, [clientName, clientLanguage, clientTimezone, clientMorningTime, clientMeasurementTime, clientMeasurementDay]);

  const handleSaveEdit = useCallback(async () => {
    setEditLoading(true);
    setEditError(null);
    try {
      const payload: {
        name: string;
        language: string;
        timezone: string | null;
        morning_time: string | null;
        measurement_time: string | null;
        measurement_day: number | null;
      } = {
        name: editForm.name,
        language: editForm.language,
        timezone: editForm.timezone || null,
        morning_time: editForm.morning_time || null,
        measurement_time: editForm.measurement_time || null,
        measurement_day: editForm.measurement_day ? Number(editForm.measurement_day) : null,
      };
      const result = await updateClient(clientId, payload);
      if (result.error) {
        setEditError(result.error);
        return;
      }
      setShowEditDialog(false);
      router.refresh();
    } catch {
      setEditError("Произошла ошибка");
    } finally {
      setEditLoading(false);
    }
  }, [clientId, editForm, router]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" onClick={openEditDialog}>
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

        {currentPaymentStatus && (
          <Button
            type="button"
            variant="outline"
            onClick={handleTogglePayment}
            disabled={toggling}
          >
            {toggling
              ? "Смена..."
              : currentPaymentStatus === "paid"
                ? "Снять оплату"
                : "Отметить оплаченным"}
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

      <Dialog
        open={showEditDialog}
        onOpenChange={(open) => {
          setShowEditDialog(open);
          if (!open) {
            setEditError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редактировать клиента</DialogTitle>
            <DialogDescription>
              Измените данные клиента и нажмите «Сохранить».
            </DialogDescription>
          </DialogHeader>
          {editError && (
            <p className="text-sm text-destructive" role="alert">{editError}</p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSaveEdit();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <label htmlFor="edit-name" className="text-sm font-medium">Имя</label>
              <Input
                id="edit-name"
                type="text"
                maxLength={200}
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="edit-language" className="text-sm font-medium">Язык</label>
              <Select
                value={editForm.language}
                onValueChange={(v) => v && setEditForm((f) => ({ ...f, language: v }))}
              >
                <SelectTrigger id="edit-language" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LANGUAGE_LABELS).map(([code, label]) => (
                    <SelectItem key={code} value={code}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label htmlFor="edit-timezone" className="text-sm font-medium">Часовой пояс</label>
              <Select
                value={editForm.timezone}
                onValueChange={(v) => setEditForm((f) => ({ ...f, timezone: v ?? "" }))}
              >
                <SelectTrigger id="edit-timezone" className="w-full">
                  <SelectValue placeholder="Не задан" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Не задан</SelectItem>
                  {TIMEZONE_LIST.map((tz) => (
                    <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label htmlFor="edit-morning" className="text-sm font-medium">Утро (напоминание, HH:MM)</label>
              <Input
                id="edit-morning"
                type="time"
                value={editForm.morning_time}
                onChange={(e) => setEditForm((f) => ({ ...f, morning_time: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="edit-meas-day" className="text-sm font-medium">День замеров</label>
              <Select
                value={editForm.measurement_day}
                onValueChange={(v) => setEditForm((f) => ({ ...f, measurement_day: v ?? "" }))}
              >
                <SelectTrigger id="edit-meas-day" className="w-full">
                  <SelectValue placeholder="Не задан" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Не задан</SelectItem>
                  {MEASUREMENT_DAY_OPTIONS.map(({ value, label }) => (
                    <SelectItem key={value} value={String(value)}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label htmlFor="edit-meas-time" className="text-sm font-medium">Время замеров (HH:MM)</label>
              <Input
                id="edit-meas-time"
                type="time"
                value={editForm.measurement_time}
                onChange={(e) => setEditForm((f) => ({ ...f, measurement_time: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>
                Отмена
              </DialogClose>
              <Button type="submit" disabled={editLoading || !editForm.name.trim()}>
                {editLoading ? "Сохранение..." : "Сохранить"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
