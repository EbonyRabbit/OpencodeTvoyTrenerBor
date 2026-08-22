"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getActivePrograms,
  activateProgram,
  generateConnectCode,
  generateClientToken,
  disableClient,
  deleteClient,
  markPurchased,
  sendProgramInstructions,
  togglePayment,
  updateClient,
  createPaymentLink,
  sendPaymentLinkToClient,
  getPayablePrograms,
} from "../actions";
import { TIMEZONE_LIST, MEASUREMENT_DAY_OPTIONS, CHECKIN_DAY_OPTIONS, LANGUAGE_LABELS, WEEKDAY_OPTIONS } from "@/lib/clients";
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
type Program = { id: string; title: string; type: string };
type PayableProgram = { id: string; title: string; price: number | null };

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
  clientCheckinDay,
  clientCheckinTime,
  clientTrainingDays,
  programDayOrders,
  clientTelegramId,
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
  clientCheckinDay: number | null;
  clientCheckinTime: string | null;
  clientTrainingDays?: number[] | null;
  programDayOrders?: number[];
  clientTelegramId?: number | null;
}) {
  const router = useRouter();
  const [activating, setActivating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [loadingPrograms, setLoadingPrograms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [showProgramSelect, setShowProgramSelect] = useState(false);
  const [selectedProgram, setSelectedProgram] = useState<string>("");
  const [newCode, setNewCode] = useState<string | null>(null);
  const [generatingToken, setGeneratingToken] = useState(false);
  const [portalLink, setPortalLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [showPurchaseDialog, setShowPurchaseDialog] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [purchaseSuccess, setPurchaseSuccess] = useState<{
    connectCode?: string;
    warning?: string;
  } | null>(null);

  const [instructing, setInstructing] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [instructionsResult, setInstructionsResult] = useState<{
    connectCode?: string;
    warning?: string;
  } | null>(null);

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [payLinkOpen, setPayLinkOpen] = useState(false);
  const [payPrograms, setPayPrograms] = useState<PayableProgram[]>([]);
  const [payLoadingPrograms, setPayLoadingPrograms] = useState(false);
  const [paySelected, setPaySelected] = useState("");
  const [payCreating, setPayCreating] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [payResult, setPayResult] = useState<{ url: string; requestId: string } | null>(null);
  const [paySending, setPaySending] = useState(false);
  const [paySent, setPaySent] = useState(false);
  const [payCopied, setPayCopied] = useState(false);
  const [editForm, setEditForm] = useState<{
    name: string;
    language: string;
    timezone: string;
    morning_time: string;
    measurement_time: string;
    measurement_day: string;
    checkin_day: string;
    checkin_time: string;
    training_days: (number | null)[];
  }>({
    name: "",
    language: "ru",
    timezone: "",
    morning_time: "",
    measurement_time: "",
    measurement_day: "",
    checkin_day: "",
    checkin_time: "",
    training_days: [],
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
        if (result.programAssigned) {
          setShowProgramSelect(false);
          setSelectedProgram("");
          setPrograms([]);
          router.refresh();
        }
        setError(result.error);
        return;
      }
      setShowProgramSelect(false);
      setSelectedProgram("");
      setPrograms([]);
      setInstructionsResult({
        connectCode: result.connectCode,
        warning: result.warning,
      });
      setInstructionsOpen(true);
      router.refresh();
    } catch {
      setError("Произошла ошибка");
    } finally {
      setActivating(false);
    }
  }, [clientId, selectedProgram, router]);

  const handleSendInstructions = useCallback(async () => {
    if (!currentProgramId) return;
    setInstructing(true);
    setError(null);
    try {
      const result = await sendProgramInstructions(clientId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setInstructionsResult({
        connectCode: result.connectCode,
        warning: result.warning,
      });
      setInstructionsOpen(true);
      router.refresh();
    } catch {
      setError("Произошла ошибка");
    } finally {
      setInstructing(false);
    }
  }, [clientId, currentProgramId, router]);

  const handleGenerateCode = useCallback(async () => {
    if (currentCode && !confirm("Сгенерировать новый код подключения?")) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await generateConnectCode(clientId);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.code) {
        setNewCode(result.code);
        router.refresh();
      }
    } catch {
      setError("Произошла ошибка");
    } finally {
      setGenerating(false);
    }
  }, [clientId, currentCode, router]);

  const handleGeneratePortalLink = useCallback(async () => {
    if (portalLink && !confirm("Сгенерировать новую ссылку? Старая перестанет работать.")) return;
    setGeneratingToken(true);
    setError(null);
    try {
      const result = await generateClientToken(clientId);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.token) {
        const url = `${window.location.origin}/client/${result.token}`;
        setPortalLink(url);
      }
    } catch {
      setError("Произошла ошибка");
    } finally {
      setGeneratingToken(false);
    }
  }, [clientId, portalLink]);

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

  const handleDelete = useCallback(async () => {
    if (
      !confirm(
        "Удалить клиента БЕЗВОЗВРАТНО? Все данные (тренировки, замеры, чек-ины, чат) будут удалены навсегда. Это действие нельзя отменить.",
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const result = await deleteClient(clientId);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.replace("/clients");
    } catch {
      setError("Произошла ошибка");
    } finally {
      setDeleting(false);
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
  }, []);

  const handleConfirmPurchase = useCallback(async () => {
    if (!selectedProgram) return;
    setConfirming(true);
    setError(null);
    try {
      const result = await markPurchased(clientId, selectedProgram);
      if (result.error) {
        if (result.programAssigned) {
          setShowPurchaseDialog(false);
          setPurchaseSuccess(null);
          setSelectedProgram("");
          router.refresh();
        }
        setError(result.error);
        return;
      }
      setPurchaseSuccess({ connectCode: result.connectCode, warning: result.warning });
      router.refresh();
    } catch {
      setError("Произошла ошибка");
    } finally {
      setConfirming(false);
    }
  }, [clientId, selectedProgram, router]);

  const openPayLinkDialog = useCallback(async () => {
    setPayError(null);
    setPayResult(null);
    setPaySent(false);
    setPayCopied(false);
    setPaySelected("");
    setPayLinkOpen(true);

    setPayPrograms([]);
    setPayLoadingPrograms(true);
    try {
      const payList = await getPayablePrograms();
      setPayPrograms(payList);
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Ошибка загрузки программ");
    } finally {
      setPayLoadingPrograms(false);
    }
  }, []);

  const handleCreatePaymentLink = useCallback(async () => {
    if (!paySelected) return;
    setPayCreating(true);
    setPayError(null);
    try {
      const result = await createPaymentLink(clientId, paySelected);
      if (result.error || !result.url || !result.requestId) {
        setPayError(result.error ?? "Не удалось создать ссылку");
        return;
      }
      setPayResult({ url: result.url, requestId: result.requestId });
      router.refresh();
    } catch {
      setPayError("Произошла ошибка");
    } finally {
      setPayCreating(false);
    }
  }, [clientId, paySelected, router]);

  const handleSendPaymentLink = useCallback(async () => {
    if (!payResult) return;
    setPaySending(true);
    setPayError(null);
    try {
      const result = await sendPaymentLinkToClient(clientId, payResult.requestId);
      if (result.error) {
        setPayError(result.error);
        return;
      }
      setPaySent(true);
    } catch {
      setPayError("Произошла ошибка");
    } finally {
      setPaySending(false);
    }
  }, [clientId, payResult]);

  const openEditDialog = useCallback(() => {
    setEditError(null);
    setEditForm({
      name: clientName,
      language: clientLanguage,
      timezone: clientTimezone ?? "",
      morning_time: (clientMorningTime ?? "").slice(0, 5),
      measurement_time: (clientMeasurementTime ?? "").slice(0, 5),
      measurement_day: clientMeasurementDay != null ? String(clientMeasurementDay) : "",
      checkin_day: clientCheckinDay != null ? String(clientCheckinDay) : "",
      checkin_time: (clientCheckinTime ?? "").slice(0, 5),
      training_days: (programDayOrders ?? []).map((_, i) => clientTrainingDays?.[i] ?? null),
    });
    setShowEditDialog(true);
  }, [clientName, clientLanguage, clientTimezone, clientMorningTime, clientMeasurementTime, clientMeasurementDay, clientCheckinDay, clientCheckinTime, clientTrainingDays, programDayOrders]);

  const handleUpdateTrainingDay = useCallback((index: number, value: number | null) => {
    setEditForm((f) => {
      const next = [...f.training_days];
      const prevValue = next[index];
      next[index] = value;
      if (prevValue != null && value != null && prevValue !== value) {
        for (let i = 0; i < next.length; i++) {
          if (i !== index && next[i] === value) next[i] = null;
        }
      }
      return { ...f, training_days: next };
    });
  }, []);

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
        checkin_day: number | null;
        checkin_time: string | null;
        training_days: number[] | null;
      } = {
        name: editForm.name,
        language: editForm.language,
        timezone: editForm.timezone || null,
        morning_time: editForm.morning_time || null,
        measurement_time: editForm.measurement_time || null,
        measurement_day: editForm.measurement_day ? Number(editForm.measurement_day) : null,
        checkin_day: editForm.checkin_day ? Number(editForm.checkin_day) : null,
        checkin_time: editForm.checkin_time || null,
        training_days:
          programDayOrders && programDayOrders.length > 0
            ? editForm.training_days.map((d) => d as number)
            : null,
      };
      if (
        payload.training_days &&
        payload.training_days.some((d) => d == null)
      ) {
        setEditError("Выберите день недели для каждой тренировки");
        return;
      }
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
  }, [clientId, editForm, programDayOrders, router]);

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
            disabled={currentPaymentStatus !== "paid" || loadingPrograms}
            title={currentPaymentStatus !== "paid" ? "Сначала подтвердите оплату" : ""}
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
                      {p.type === "personal" ? " — персональная" : ""}
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
          onClick={handleSendInstructions}
          disabled={
            !currentProgramId || currentPaymentStatus !== "paid" || instructing
          }
          title={
            !currentProgramId
              ? "Сначала назначьте программу"
              : currentPaymentStatus !== "paid"
                ? "Сначала подтвердите оплату"
                : ""
          }
        >
          {instructing ? "Отправка..." : "Отправить инструкции"}
        </Button>

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
          variant="outline"
          onClick={handleGeneratePortalLink}
          disabled={generatingToken}
        >
          {generatingToken ? "Генерация..." : "Ссылка для клиента"}
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={openPayLinkDialog}
        >
          Ссылка на оплату
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

        <Button
          type="button"
          variant="destructive"
          onClick={handleDelete}
          disabled={deleting}
          className="border-red-600/40 bg-transparent text-red-600 hover:bg-red-600 hover:text-white"
        >
          {deleting ? "Удаление..." : "Удалить клиента"}
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
      {portalLink && (
        <p className="text-sm text-muted-foreground">
          Ссылка для клиента:{" "}
          <span className="font-mono font-medium text-foreground break-all">
            {portalLink}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-2 h-6 px-2"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(portalLink);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                window.prompt("Скопируйте ссылку вручную:", portalLink);
              }
            }}
          >
            {copied ? "✓ Скопировано" : "Копировать"}
          </Button>
        </p>
      )}

      {error && (
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
                  {purchaseSuccess.warning ??
                    "Программа назначена, клиент уведомлён в Telegram."}
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
                  Выберите программу для назначения клиенту.
                </DialogDescription>
              </DialogHeader>
              {error && (
                <p className="text-sm text-destructive" role="alert">{error}</p>
              )}
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
                        {p.type === "personal" ? " — персональная" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  Отмена
                </DialogClose>
                {programs.length > 0 && (
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
        open={instructionsOpen}
        onOpenChange={(open) => {
          setInstructionsOpen(open);
          if (!open) {
            setInstructionsResult(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {instructionsResult?.warning
                ? "Инструкции не доставлены"
                : "Инструкции отправлены"}
            </DialogTitle>
            <DialogDescription>
              {instructionsResult?.warning ??
                "Сообщение с инструкциями отправлено клиенту в Telegram."}
            </DialogDescription>
          </DialogHeader>
          {instructionsResult?.connectCode && (
            <div className="rounded-md bg-muted p-3">
              <p className="text-sm text-muted-foreground">
                Код подключения для клиента:
              </p>
              <p className="font-mono text-lg font-bold">
                {instructionsResult.connectCode}
              </p>
            </div>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Закрыть
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={payLinkOpen}
        onOpenChange={(open) => {
          setPayLinkOpen(open);
        }}
      >
        <DialogContent>
          {payResult ? (
            <>
              <DialogHeader>
                <DialogTitle>Ссылка на оплату готова</DialogTitle>
                <DialogDescription>
                  Отправьте ссылку клиенту или отправьте её в Telegram одной кнопкой.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-md bg-muted p-3">
                <p className="text-xs text-muted-foreground">Платёжная ссылка:</p>
                <p className="font-mono text-sm break-all">{payResult.url}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2 h-7 px-2"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(payResult.url);
                      setPayCopied(true);
                      setTimeout(() => setPayCopied(false), 2000);
                    } catch {
                      window.prompt("Скопируйте ссылку вручную:", payResult.url);
                    }
                  }}
                >
                  {payCopied ? "✓ Скопировано" : "Копировать"}
                </Button>
              </div>
              {payError && (
                <p className="text-sm text-destructive" role="alert">{payError}</p>
              )}
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  Закрыть
                </DialogClose>
                {clientTelegramId != null ? (
                  <Button
                    onClick={handleSendPaymentLink}
                    disabled={paySending || paySent}
                  >
                    {paySent
                      ? "✓ Отправлено"
                      : paySending
                        ? "Отправка..."
                        : "Отправить в Telegram"}
                  </Button>
                ) : (
                  <span title="Клиент не подключён к боту">
                    <Button disabled>Нет Telegram</Button>
                  </span>
                )}
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Ссылка на оплату</DialogTitle>
                <DialogDescription>
                  Выберите программу — клиент получит ссылку на оплату через Продамус.
                  После оплаты доступ откроется автоматически.
                </DialogDescription>
              </DialogHeader>
              {payError && (
                <p className="text-sm text-destructive" role="alert">{payError}</p>
              )}
              {payLoadingPrograms ? (
                <p className="text-sm text-muted-foreground">Загрузка...</p>
              ) : payPrograms.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Нет активных программ с ценой
                </p>
              ) : (
                <Select value={paySelected} onValueChange={(v) => v && setPaySelected(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Выберите программу" />
                  </SelectTrigger>
                  <SelectContent>
                    {payPrograms.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.title}
                        {p.price != null ? ` — ${p.price.toLocaleString("ru-RU")} ₽` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  Отмена
                </DialogClose>
                {payPrograms.length > 0 && (
                  <Button
                    onClick={handleCreatePaymentLink}
                    disabled={!paySelected || payCreating}
                  >
                    {payCreating ? "Создание..." : "Создать ссылку"}
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
                step={900}
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
                step={900}
                value={editForm.measurement_time}
                onChange={(e) => setEditForm((f) => ({ ...f, measurement_time: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="edit-checkin-day" className="text-sm font-medium">Чек-ин — день недели</label>
              <Select
                value={editForm.checkin_day}
                onValueChange={(v) => setEditForm((f) => ({ ...f, checkin_day: v ?? "" }))}
              >
                <SelectTrigger id="edit-checkin-day" className="w-full">
                  <SelectValue placeholder="Не задан" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Не задан</SelectItem>
                  {CHECKIN_DAY_OPTIONS.map(({ value, label }) => (
                    <SelectItem key={value} value={String(value)}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label htmlFor="edit-checkin-time" className="text-sm font-medium">Чек-ин — время (HH:MM)</label>
              <Input
                id="edit-checkin-time"
                type="time"
                step={900}
                value={editForm.checkin_time}
                onChange={(e) => setEditForm((f) => ({ ...f, checkin_time: e.target.value }))}
              />
            </div>

            {programDayOrders && programDayOrders.length > 0 && (
              <div className="space-y-3 border-t pt-4">
                <div>
                  <p className="text-sm font-medium">Расписание тренировок</p>
                  <p className="text-xs text-muted-foreground">
                    Выберите дни недели для каждой тренировки.
                  </p>
                </div>
                {programDayOrders.map((order, i) => (
                  <div key={order} className="grid grid-cols-[80px_1fr] items-center gap-2">
                    <span className="text-sm">День {order}</span>
                    <Select
                      value={editForm.training_days[i] != null ? String(editForm.training_days[i]) : ""}
                      onValueChange={(v) => handleUpdateTrainingDay(i, v ? Number(v) : null)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Не выбран" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Не выбран</SelectItem>
                        {WEEKDAY_OPTIONS.map(({ value, label }) => {
                          const taken = editForm.training_days.some(
                            (d, di) => di !== i && d === value,
                          );
                          return (
                            <SelectItem key={value} value={String(value)} disabled={taken}>
                              {label}{taken ? " (занят)" : ""}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            )}

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
