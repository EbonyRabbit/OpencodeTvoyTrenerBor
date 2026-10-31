import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Database } from "@/types/supabase";
import { generateSchedule } from "@/lib/plan-adjustment";
import { sendTelegramMessage } from "@/lib/telegram";
import { sendCoachAlertOnce } from "@/lib/coach-alert";
import { buildProgramInstructions } from "@/lib/program-instructions";
import { UUID_REGEX, formatContact, sanitizeText } from "@/lib/validation";
import { formatPrice } from "@/lib/format-price";

const MAX_NAME_LENGTH = 120;
const STALE_LINK_MS = 10 * 60 * 1000;
const CLIENT_SELECT_COLUMNS =
  "id, name, language, telegram_id, connect_code, timezone, program_id, access_end_date";

export async function generateConnectCodeFor(
  clientId: string,
): Promise<string | null> {
  for (let i = 0; i < 5; i++) {
    const code = crypto.randomUUID().slice(0, 8).toUpperCase();
    const { error } = await supabaseAdmin
      .from("clients")
      .update({ connect_code: code })
      .eq("id", clientId);
    if (!error) return code;
    if (error.code !== "23505") {
      console.error("[CONNECT_CODE] Failed to save code:", error.message);
      return null;
    }
  }
  return null;
}

function resolveConnectCode(client: {
  telegram_id: number | null;
  connect_code: string | null;
}): string | null {
  if (client.telegram_id) return null;
  return client.connect_code;
}

export async function resetPlanAssignments(
  clientId: string,
): Promise<{ error?: string }> {
  const { error: scheduleError } = await supabaseAdmin
    .from("program_schedule")
    .delete()
    .eq("client_id", clientId);
  if (scheduleError) {
    console.error("[ACTIVATION] schedule reset failed:", scheduleError.message);
    return { error: "Не удалось сбросить старое расписание." };
  }
  const { error: pausesError } = await supabaseAdmin
    .from("plan_pauses")
    .delete()
    .eq("client_id", clientId);
  if (pausesError) {
    console.error(
      "[ACTIVATION] plan pauses reset failed:",
      pausesError.message,
    );
    return { error: "Не удалось сбросить паузы плана." };
  }
  return {};
}

export type ClientForInstructions = {
  name: string | null;
  language: string;
  telegram_id: number | null;
  connect_code: string | null;
  timezone: string | null;
  program_id?: string | null;
  access_end_date?: string | null;
};

type ProgramAssignment = {
  clientId: string;
  client: ClientForInstructions;
  programId: string;
  programTitle: string;
  accessEndDate: string;
  coachId: string | null;
  telegramIdToRecord?: number | null;
};

export async function assignProgramAndNotify(
  input: ProgramAssignment,
): Promise<{
  error?: string;
  connectCode?: string;
  warning?: string;
  programAssigned?: boolean;
  retryable?: boolean;
}> {
  const resetError = await resetPlanAssignments(input.clientId);
  if (resetError.error) {
    return {
      error: resetError.error,
      programAssigned: true,
      retryable: true,
    };
  }

  const scheduleError = await generateSchedule(input.clientId, input.programId);
  if (scheduleError.error) {
    console.error(
      "[ACTIVATION] schedule generation failed:",
      scheduleError.error,
    );
    return {
      error: "Программа назначена, но не удалось создать расписание.",
      programAssigned: true,
      retryable: true,
    };
  }

  const { connectCode, warning } = await notifyClientForProgram(
    input.clientId,
    input.client,
    input.programTitle,
    input.accessEndDate,
    input.coachId,
    input.telegramIdToRecord,
  );

  return { connectCode, warning };
}

export async function notifyClientForProgram(
  clientId: string,
  client: ClientForInstructions,
  programTitle: string,
  accessEndDate: string | null,
  coachId: string | null,
  telegramIdToRecord?: number | null,
): Promise<{ connectCode?: string; warning?: string }> {
  const deliveryTelegramId = telegramIdToRecord ?? client.telegram_id;
  let connectCode: string | null = null;
  if (!deliveryTelegramId) {
    connectCode =
      resolveConnectCode(client) ?? (await generateConnectCodeFor(clientId));
  }

  const delivery = await deliverProgramInstructions({
    clientId,
    clientName: client.name ?? "",
    clientLanguage: client.language,
    clientTelegramId: deliveryTelegramId,
    connectCode,
    programTitle,
    accessEndDate,
    timezone: client.timezone,
    coachId,
  });

  return { connectCode: connectCode ?? undefined, warning: delivery.warning };
}

type DeliverInstructionsInput = {
  clientId: string;
  clientName: string;
  clientLanguage: string;
  clientTelegramId: number | null;
  connectCode: string | null;
  programTitle: string;
  accessEndDate: string | null;
  timezone: string | null;
  coachId: string | null;
};

export async function deliverProgramInstructions(
  input: DeliverInstructionsInput,
): Promise<{ warning?: string }> {
  const text = buildProgramInstructions({
    name: truncateText(sanitizeText(input.clientName), MAX_NAME_LENGTH),
    language: input.clientLanguage,
    programTitle: truncateText(
      sanitizeText(input.programTitle),
      MAX_NAME_LENGTH,
    ),
    accessEndDate: input.accessEndDate,
    connectCode: input.connectCode,
    botUsername: process.env.TELEGRAM_BOT_USERNAME ?? null,
    timezone: input.timezone,
  });

  const saveMessage = async (): Promise<{ error?: string }> => {
    const { error } = await supabaseAdmin.from("messages").insert({
      client_id: input.clientId,
      coach_id: input.coachId,
      direction: "to_client",
      text,
      sent_at: new Date().toISOString(),
      read_at: null,
    });
    if (error) {
      console.error("[INSTRUCTIONS] Failed to save message:", error.message);
      return { error: error.message };
    }
    return {};
  };

  if (input.clientTelegramId) {
    const sent = await sendTelegramMessage(input.clientTelegramId, text);
    if (!sent) {
      // Не сохраняем запись до успешной доставки: hasInstructionsFor иначе
      // примет её за доставленные инструкции и не повторит отправку.
      return {
        warning:
          "Инструкции не доставлены в Telegram. Проверьте, что клиент не заблокировал бота и что токен бота настроен, затем повторите отправку.",
      };
    }
    const saved = await saveMessage();
    return saved.error
      ? {
          warning:
            "Инструкции доставлены в Telegram, но не сохранены в истории чата.",
        }
      : {};
  }

  const saved = await saveMessage();
  if (input.connectCode) {
    return {
      warning: saved.error
        ? "Инструкции не сохранены в истории чата. Передайте клиенту код подключения."
        : "Клиент не подключён к Telegram. Передайте ему код подключения; после подключения отправьте инструкции ещё раз кнопкой «Отправить инструкции».",
    };
  }
  return {
    warning: saved.error
      ? "Инструкции не сохранены в истории чата, а код подключения не удалось сгенерировать. Попробуйте кнопкой «Код подключения»."
      : "Клиент не подключён к Telegram, а код подключения не удалось сгенерировать. Попробуйте кнопкой «Код подключения».",
  };
}

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.trim();
    if (cleaned === "") return null;
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function truncateText(text: string, maxLength: number): string {
  return Array.from(text).slice(0, maxLength).join("");
}

export function buildActivationCoachMessage({
  clientName,
  telegramId,
  contact,
  programTitle,
  price,
  amount,
  durationWeeks,
  accessEndDate,
}: {
  clientName: string;
  telegramId: number | null;
  contact: string | null;
  programTitle: string;
  price: number | null;
  amount: number | null;
  durationWeeks: number;
  accessEndDate: string;
}): string {
  const cleanName =
    truncateText(sanitizeText(clientName), MAX_NAME_LENGTH) || "Клиент";
  const cleanProgram = truncateText(
    sanitizeText(programTitle),
    MAX_NAME_LENGTH,
  );
  const priceLine =
    price !== null && price !== undefined
      ? `\nЦена: ${formatPrice(price)} ₽`
      : "";
  const amountLine =
    amount !== null && amount !== undefined && amount !== price
      ? `\nСумма оплаты: ${amount.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`
      : "";
  const contactLine = contact
    ? `\n📱 Контакт: ${sanitizeText(formatContact(contact))}`
    : telegramId !== null && telegramId !== undefined
      ? `\n🆔 TG ID: ${telegramId}`
      : "";
  const dateLine = `\nДоступ до: ${new Intl.DateTimeFormat("ru-RU").format(new Date(accessEndDate))}`;

  return (
    `✅ Оплата подтверждена\n\n` +
    `Программа: ${cleanProgram}${priceLine}${amountLine}\n` +
    `Длительность: ${durationWeeks} нед.\n\n` +
    `👤 Клиент: ${cleanName}${contactLine}${dateLine}`
  );
}

export type ActivationResult = {
  error?: string;
  connectCode?: string;
  warning?: string;
  programAssigned?: boolean;
  retryable?: boolean;
  alerted?: boolean;
  inProgress?: true;
};

export async function applyProgramActivation({
  clientId,
  client,
  programId,
  programTitle,
  price,
  durationWeeks,
  amount,
  contact,
  coachId,
  telegramIdToRecord,
}: {
  clientId: string;
  client: ClientForInstructions;
  programId: string;
  programTitle: string;
  price: number | null;
  durationWeeks: number;
  amount: number | null;
  contact: string | null;
  coachId: string | null;
  telegramIdToRecord?: number | null;
}): Promise<ActivationResult> {
  if (durationWeeks <= 0)
    return { error: "Некорректная длительность программы" };

  const now = new Date();
  const endDate = new Date(
    now.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000,
  );
  const accessEndDate = endDate.toISOString();

  const sameActiveProgram =
    client.program_id === programId &&
    client.access_end_date !== null &&
    client.access_end_date !== undefined &&
    new Date(client.access_end_date).getTime() > now.getTime();
  const effectiveAccessEndDate =
    sameActiveProgram && client.access_end_date
      ? client.access_end_date
      : accessEndDate;

  const update: Database["public"]["Tables"]["clients"]["Update"] = {
    program_id: programId,
    purchased_program_id: programId,
    payment_status: "paid",
    status: "active",
  };
  if (
    telegramIdToRecord !== null &&
    telegramIdToRecord !== undefined &&
    client.telegram_id === null
  ) {
    const { error: telegramError } = await supabaseAdmin
      .from("clients")
      .update({ telegram_id: telegramIdToRecord })
      .eq("id", clientId)
      .is("telegram_id", null);
    if (telegramError) {
      console.error(
        "[ACTIVATION] Telegram link failed:",
        telegramError.message,
      );
    }
  }
  if (!sameActiveProgram) {
    update.access_start_date = now.toISOString();
    update.access_end_date = accessEndDate;
    update.purchase_date = now.toISOString();
  }

  const { error: updateError } = await supabaseAdmin
    .from("clients")
    .update(update)
    .eq("id", clientId);
  if (updateError) {
    console.error("[ACTIVATION] Client update failed:", updateError.message);
    return { error: "Не удалось обновить данные клиента.", retryable: true };
  }

  const assignment = await assignProgramAndNotify({
    clientId,
    client,
    programId,
    programTitle,
    accessEndDate: effectiveAccessEndDate,
    coachId,
    telegramIdToRecord: telegramIdToRecord ?? null,
  });
  if (assignment.error) return assignment;

  const coachChatId = process.env.COACH_CHAT_ID;
  if (coachChatId) {
    const sent = await sendTelegramMessage(
      coachChatId,
      buildActivationCoachMessage({
        clientName: client.name ?? "Клиент",
        telegramId: client.telegram_id,
        contact,
        programTitle,
        price,
        amount,
        durationWeeks,
        accessEndDate: effectiveAccessEndDate,
      }),
    );
    if (!sent) {
      console.error("[ACTIVATION] Coach notification failed");
    }
  } else {
    console.error(
      "[ACTIVATION] COACH_CHAT_ID is not set; coach notification skipped",
    );
  }

  return assignment;
}

type CancelledPaymentInfo = {
  name: string;
  contact: string;
  amount: number | null;
};

async function alertCancelledPayment(
  orderId: string,
  request: CancelledPaymentInfo,
): Promise<boolean> {
  const amountText =
    request.amount != null
      ? ` на сумму ${request.amount.toLocaleString("ru-RU")} ₽`
      : "";
  return sendCoachAlertOnce(
    `cancelled_payment:${orderId}`,
    `⚠️ Получена оплата${amountText} по ОТМЕНЁННОЙ заявке ${orderId} (клиент: ${sanitizeText(request.name)}, контакт: ${formatContact(request.contact)}). Доступ не выдан - сделайте возврат или выдайте доступ вручную.`,
  );
}

export async function activatePurchaseByOrder({
  orderId,
  coachId,
  paymentStatus,
  paidSum,
}: {
  orderId: string;
  coachId: string | null;
  paymentStatus?: string;
  paidSum?: number | string | null;
}): Promise<
  ActivationResult & {
    alreadyActivated?: boolean;
    requestId?: string;
    clientId?: string | null;
  }
> {
  try {
    if (!UUID_REGEX.test(orderId)) return { error: "Некорректный заказ." };

    const { data: request, error: requestError } = await supabaseAdmin
      .from("purchase_requests")
      .select(
        "id, status, sub_type, program_id, amount, name, contact, telegram_id, first_name, last_name, consent_given, consent_at, consent_version, client_id",
      )
      .eq("order_id", orderId)
      .maybeSingle();
    if (requestError) {
      console.error("[ACTIVATION] Request lookup error:", requestError.message);
      return { error: "Ошибка при обработке заказа.", retryable: true };
    }
    if (!request) return { error: "Заявка не найдена." };
    if (request.status === "cancelled") {
      if (paymentStatus === "success") {
        const alerted = await alertCancelledPayment(orderId, request);
        return {
          error: "Заявка отменена.",
          alerted,
          retryable: !alerted,
        };
      }
      return { error: "Заявка отменена.", alerted: false };
    }
    if (request.sub_type !== "program") {
      return { error: "Неподдерживаемый тип заявки." };
    }
    if (request.program_id === null) {
      return { error: "Программа недоступна для активации." };
    }
    if (!request.consent_given) {
      return { error: "Не подтверждено согласие на обработку данных." };
    }

    const { data: program, error: programError } = await supabaseAdmin
      .from("programs")
      .select("id, title, price, duration_weeks")
      .eq("id", request.program_id)
      .eq("active", true)
      .maybeSingle();
    if (programError) {
      console.error("[ACTIVATION] Program lookup error:", programError.message);
      return { error: "Ошибка при проверке программы.", retryable: true };
    }
    if (!program) return { error: "Программа недоступна для активации." };
    if (program.duration_weeks <= 0) {
      return { error: "Некорректная длительность программы" };
    }

    const price = toFiniteNumber(program.price);
    const amount = toFiniteNumber(request.amount);

    if (paymentStatus !== undefined && paymentStatus !== "success") {
      console.error(
        "[ACTIVATION] Payment not confirmed for",
        orderId,
        "status:",
        paymentStatus,
      );
      return { error: "Платёж не подтверждён." };
    }

    const expectedAmount = amount ?? price;
    if (paymentStatus === "success") {
      if (expectedAmount === null || expectedAmount <= 0) {
        console.error(
          "[ACTIVATION] Cannot verify payment for",
          orderId,
          "- no usable amount",
        );
        return { error: "Не удалось проверить сумму оплаты." };
      }
      const paid = toFiniteNumber(paidSum);
      if (paid === null || paid < expectedAmount) {
        console.error(
          "[ACTIVATION] Payment sum mismatch for",
          orderId,
          "expected:",
          expectedAmount,
          "paid:",
          paid,
        );
        return { error: "Сумма оплаты не совпадает с ожидаемой." };
      }
    }

    const { data: claimed, error: claimError } = await supabaseAdmin
      .from("purchase_requests")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
      })
      .eq("id", request.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (claimError) {
      console.error("[ACTIVATION] Claim failed:", claimError.message);
      return { error: "Ошибка обновления статуса заказа.", retryable: true };
    }

    let clientId: string | null = null;
    let client: ClientForInstructions | null = null;

    if (!claimed) {
      const { data: current } = await supabaseAdmin
        .from("purchase_requests")
        .select("status, client_id, paid_at")
        .eq("id", request.id)
        .maybeSingle();
      if (current?.status !== "paid") {
        if (current?.status === "cancelled" && paymentStatus === "success") {
          const alerted = await alertCancelledPayment(orderId, request);
          return {
            error: "Заявка отменена.",
            requestId: request.id,
            alerted,
            retryable: !alerted,
          };
        }
        return { error: "Заявка уже была обработана.", requestId: request.id };
      }
      if (current.client_id) {
        const recovered = await recoverLinkedRequest({
          requestId: request.id,
          clientId: current.client_id,
          paidAt: current.paid_at ?? null,
          programId: request.program_id,
          telegramId: request.telegram_id,
        });
        if (recovered.kind === "alreadyActivated") {
          return {
            alreadyActivated: true,
            requestId: request.id,
            clientId: recovered.clientId,
          };
        }
        if (recovered.kind === "inProgress") {
          return {
            error: "Активация уже выполняется. Повторите запрос позднее.",
            requestId: request.id,
            clientId: recovered.clientId,
            inProgress: true,
          };
        }
        if (recovered.kind === "mismatch") {
          return {
            error: "Данные клиента не совпадают. Свяжитесь с тренером.",
            requestId: request.id,
            clientId: recovered.clientId,
          };
        }
        clientId = recovered.clientId;
        client = recovered.client;
      }
    }

    if (!clientId || !client) {
      const resolution = await resolveOrCreateClient(
        {
          client_id: request.client_id,
          telegram_id: request.telegram_id,
          name: request.name,
          first_name: request.first_name,
          last_name: request.last_name,
          consent_given: request.consent_given,
          consent_at: request.consent_at,
          consent_version: request.consent_version,
        },
        request.program_id,
        program.duration_weeks,
      );
      if (!resolution.ok) {
        return { ...resolution, requestId: request.id };
      }
      clientId = resolution.clientId;
      client = resolution.client;

      const { data: linked, error: linkError } = await supabaseAdmin
        .from("purchase_requests")
        .update({ client_id: clientId })
        .eq("id", request.id)
        .eq("status", "paid")
        .is("client_id", null)
        .select("id")
        .maybeSingle();
      if (linkError) {
        console.error(
          "[ACTIVATION] request->client link failed:",
          linkError.message,
        );
        return {
          error: "Ошибка обновления заказа.",
          requestId: request.id,
          retryable: true,
        };
      }
      if (!linked) {
        const { data: current } = await supabaseAdmin
          .from("purchase_requests")
          .select("client_id, paid_at")
          .eq("id", request.id)
          .maybeSingle();
        const linkedClientId = current?.client_id ?? null;
        if (
          linkedClientId !== null &&
          linkedClientId !== clientId &&
          resolution.created
        ) {
          const { error: cleanupError } = await supabaseAdmin
            .from("clients")
            .delete()
            .eq("id", clientId);
          if (cleanupError) {
            console.error(
              "[ACTIVATION] Phantom client cleanup failed:",
              cleanupError.message,
            );
          }
        }
        if (!linkedClientId) {
          if (resolution.created) {
            // Линковка не удалась, а карточка уже создана. Для заявки без
            // Telegram повторный resolve не найдёт её по telegram_id и создаст
            // ещё одну сироту. Удаляем только что созданную карточку; retry
            // повторит resolve с чистого листа.
            const { error: orphanError } = await supabaseAdmin
              .from("clients")
              .delete()
              .eq("id", clientId)
              .is("telegram_id", null);
            if (orphanError) {
              console.error(
                "[ACTIVATION] Orphan client cleanup failed:",
                orphanError.message,
              );
            }
          }
          return {
            error: "Активация уже выполняется. Повторите запрос позднее.",
            requestId: request.id,
            clientId,
            retryable: true,
            inProgress: true,
          };
        }
        // Регрессия e2e 24.08.2026: панельные заявки (21.9) приходят с
        // предзаполненным client_id - линковка «промахивается», и раньше
        // поток проваливался в recovery, где свежий paid_at означал
        // «чужая незавершённая активация» → 503 in_progress на каждой
        // доставке, пока paid_at не состарится (10 мин). Если клейм у этой
        // инвокации и заявка изначально указывала на резолвленного клиента -
        // это первичная активация: идемпотентность обеспечил CAS-клейм,
        // продолжаем сразу. Recovery - для повторных доставок (клейм
        // проигран) и для гонок линковки у заявок без исходного client_id.
        // (клейм проигран). NB: !linkedClientId здесь недостижим - строка
        // выше уже вернула in-progress при пустом client_id.
        if (
          !claimed ||
          linkedClientId !== clientId ||
          request.client_id === null
        ) {
          const recovered = await recoverLinkedRequest({
            requestId: request.id,
            clientId: linkedClientId,
            paidAt: current?.paid_at ?? null,
            programId: request.program_id,
            telegramId: request.telegram_id,
          });
          if (recovered.kind === "alreadyActivated") {
            return {
              alreadyActivated: true,
              requestId: request.id,
              clientId: recovered.clientId,
            };
          }
          if (recovered.kind === "inProgress") {
            return {
              error: "Активация уже выполняется. Повторите запрос позднее.",
              requestId: request.id,
              clientId: recovered.clientId,
              inProgress: true,
            };
          }
          if (recovered.kind === "mismatch") {
            return {
              error: "Данные клиента не совпадают. Свяжитесь с тренером.",
              requestId: request.id,
              clientId: recovered.clientId,
            };
          }
          clientId = recovered.clientId;
          client = recovered.client;
        }
      }
    }

    const activation = await applyProgramActivation({
      clientId,
      client,
      programId: program.id,
      programTitle: program.title,
      price,
      durationWeeks: program.duration_weeks,
      amount,
      contact: request.contact,
      coachId,
      telegramIdToRecord: request.telegram_id,
    });

    return { ...activation, requestId: request.id, clientId };
  } catch (e) {
    console.error("[ACTIVATION] activatePurchaseByOrder error:", e);
    return { error: "Произошла ошибка при активации.", retryable: true };
  }
}


type RecoveryOutcome =
  | { kind: "alreadyActivated"; clientId: string }
  | { kind: "takeover"; clientId: string; client: ClientForInstructions }
  | { kind: "inProgress"; clientId: string }
  | { kind: "mismatch"; clientId: string };

async function recoverLinkedRequest({
  requestId,
  clientId,
  paidAt,
  programId,
  telegramId,
}: {
  requestId: string;
  clientId: string;
  paidAt: string | null;
  programId: string;
  telegramId: number | null;
}): Promise<RecoveryOutcome> {
  const loaded = await loadClientForInstructions(clientId);
  if (!loaded.ok) {
    if (loaded.notFound) {
      const { error: unlinkError } = await supabaseAdmin
        .from("purchase_requests")
        .update({ client_id: null })
        .eq("id", requestId)
        .eq("status", "paid")
        .eq("client_id", clientId);
      if (unlinkError) {
        console.error(
          "[ACTIVATION] Stale link cleanup failed:",
          unlinkError.message,
        );
      }
    }
    return { kind: "inProgress", clientId };
  }
  const linkedClient = loaded.client;
  if (
    telegramId !== null &&
    linkedClient.telegram_id !== null &&
    linkedClient.telegram_id !== telegramId
  ) {
    console.error(
      "[ACTIVATION] Telegram mismatch during recovery for client",
      clientId,
    );
    return { kind: "mismatch", clientId };
  }

  const activated = await isClientActivated(clientId, programId);
  if (activated) {
    const hasSchedule = await hasScheduleFor(clientId);
    if (hasSchedule) {
      if (!paidAt || (await hasInstructionsFor(clientId, paidAt))) {
        return { kind: "alreadyActivated", clientId };
      }
    }
  }

  const staleCutoff = new Date(Date.now() - STALE_LINK_MS).toISOString();
  const { data: takenOver, error: takeoverError } = await supabaseAdmin
    .from("purchase_requests")
    .update({ paid_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "paid")
    .eq("client_id", clientId)
    .or(`paid_at.is.null,paid_at.lt.${staleCutoff}`)
    .select("id")
    .maybeSingle();
  if (takeoverError) {
    console.error("[ACTIVATION] Takeover failed:", takeoverError.message);
    return { kind: "inProgress", clientId };
  }
  if (!takenOver) return { kind: "inProgress", clientId };

  return { kind: "takeover", clientId, client: linkedClient };
}

async function loadClientForInstructions(
  clientId: string,
): Promise<
  { ok: true; client: ClientForInstructions } | { ok: false; notFound: boolean }
> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select(CLIENT_SELECT_COLUMNS)
    .eq("id", clientId)
    .maybeSingle();
  if (error) {
    console.error("[ACTIVATION] Client lookup error:", error.message);
    return { ok: false, notFound: false };
  }
  if (!data) return { ok: false, notFound: true };
  return { ok: true, client: data as ClientForInstructions };
}

async function hasScheduleFor(clientId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("program_schedule")
    .select("id")
    .eq("client_id", clientId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[ACTIVATION] Schedule lookup error:", error.message);
    return false;
  }
  return data !== null;
}

async function hasInstructionsFor(
  clientId: string,
  sinceIso: string,
): Promise<boolean> {
  // Accepted limitation: any to_client message saved after paid_at counts as
  // delivered instructions. The row is now written only after Telegram accepts
  // the message, so an undelivered attempt cannot mask auto-redelivery. A save
  // failure after a successful send can still duplicate instructions on a
  // later takeover; the coach warning covers that case.
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("client_id", clientId)
    .eq("direction", "to_client")
    .gte("sent_at", sinceIso)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[ACTIVATION] Instructions lookup error:", error.message);
    return false;
  }
  return data !== null;
}

async function isClientActivated(
  clientId: string,
  programId: string | null,
): Promise<boolean> {
  const { data: client, error } = await supabaseAdmin
    .from("clients")
    .select("payment_status, program_id, access_end_date")
    .eq("id", clientId)
    .maybeSingle();
  if (error) {
    console.error("[ACTIVATION] Client status lookup error:", error.message);
    return false;
  }
  if (client?.program_id !== programId || client.payment_status !== "paid") {
    return false;
  }
  if (
    client.access_end_date &&
    new Date(client.access_end_date).getTime() > Date.now()
  ) {
    return true;
  }
  return false;
}

async function resolveOrCreateClient(
  request: {
    client_id: string | null;
    telegram_id: number | null;
    name: string;
    first_name: string | null;
    last_name: string | null;
    consent_given: boolean;
    consent_at: string | null;
    consent_version: string | null;
  },
  programId: string,
  durationWeeks: number,
): Promise<
  | {
      ok: true;
      clientId: string;
      client: ClientForInstructions;
      created: boolean;
    }
  | { ok: false; error: string; retryable?: boolean }
> {
  let clientId = request.client_id;
  let client: ClientForInstructions | null = null;
  let created = false;

  if (
    !clientId &&
    request.telegram_id !== null &&
    request.telegram_id !== undefined
  ) {
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("clients")
      .select(CLIENT_SELECT_COLUMNS)
      .eq("telegram_id", request.telegram_id)
      .maybeSingle();
    if (lookupError) {
      console.error("[ACTIVATION] Client lookup error:", lookupError.message);
      return {
        ok: false,
        error: "Ошибка при поиске клиента.",
        retryable: true,
      };
    }
    clientId = existing?.id ?? null;
    client = existing as ClientForInstructions | null;
  }

  if (clientId && !client) {
    const { data: c, error: cErr } = await supabaseAdmin
      .from("clients")
      .select(CLIENT_SELECT_COLUMNS)
      .eq("id", clientId)
      .maybeSingle();
    if (cErr) {
      console.error("[ACTIVATION] Client lookup error:", cErr.message);
      return {
        ok: false,
        error: "Ошибка при поиске клиента.",
        retryable: true,
      };
    }
    client = c as ClientForInstructions | null;
    if (
      client &&
      request.telegram_id !== null &&
      request.telegram_id !== undefined &&
      client.telegram_id !== null &&
      client.telegram_id !== request.telegram_id
    ) {
      console.error(
        "[ACTIVATION] Telegram mismatch for client",
        clientId,
        "expected",
        request.telegram_id,
        "actual",
        client.telegram_id,
      );
      return {
        ok: false,
        error: "Данные клиента не совпадают. Свяжитесь с тренером.",
      };
    }
  }

  if (!clientId || !client) {
    const now = new Date();
    const endDate = new Date(
      now.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000,
    );
    const name =
      truncateText(
        sanitizeText(
          [request.first_name, request.last_name]
            .filter(Boolean)
            .join(" ")
            .trim() || request.name,
        ),
        MAX_NAME_LENGTH,
      ) || "Клиент";
    const consentAt = request.consent_at ?? null;

    const { data: createdClient, error: createError } = await supabaseAdmin
      .from("clients")
      .insert({
        name,
        telegram_id: request.telegram_id,
        status: "active",
        payment_status: "paid",
        program_id: programId,
        purchased_program_id: programId,
        purchase_date: now.toISOString(),
        access_start_date: now.toISOString(),
        access_end_date: endDate.toISOString(),
        consent_given: request.consent_given,
        consent_given_at: consentAt,
        client_consent_given: request.consent_given,
        client_consent_given_at: consentAt,
        client_consent_version: request.consent_version,
        language: "ru",
        timezone: "UTC",
        connect_code: null,
      })
      .select("id")
      .maybeSingle();
    if (createError?.code === "23505" && request.telegram_id !== null) {
      const { data: existing, error: lookupError } = await supabaseAdmin
        .from("clients")
        .select(CLIENT_SELECT_COLUMNS)
        .eq("telegram_id", request.telegram_id)
        .maybeSingle();
      if (lookupError) {
        console.error("[ACTIVATION] Client lookup error:", lookupError.message);
        return {
          ok: false,
          error: "Ошибка при поиске клиента.",
          retryable: true,
        };
      }
      clientId = existing?.id ?? null;
      client = existing as ClientForInstructions | null;
    } else if (createError) {
      console.error(
        "[ACTIVATION] Client creation failed:",
        createError.message,
      );
      return {
        ok: false,
        error: "Не удалось создать карточку клиента.",
        retryable: true,
      };
    } else {
      created = true;
      clientId = createdClient?.id ?? null;
      client = {
        name,
        language: "ru",
        telegram_id: request.telegram_id,
        connect_code: null,
        timezone: "UTC",
        program_id: programId,
        access_end_date: endDate.toISOString(),
      };
    }
  }
  if (!clientId || !client) {
    return { ok: false, error: "Не удалось определить клиента." };
  }
  return { ok: true, clientId, client, created };
}
