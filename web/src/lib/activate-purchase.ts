import { supabaseAdmin } from "@/lib/supabase-admin";
import { generateSchedule } from "@/lib/plan-adjustment";
import { sendTelegramMessage } from "@/lib/telegram";
import { buildProgramInstructions } from "@/lib/program-instructions";
import { UUID_REGEX, formatContact } from "@/lib/validation";
import { formatPrice } from "@/lib/format-price";

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
    return {
      error: `Не удалось сбросить старое расписание: ${scheduleError.message}`,
    };
  }
  const { error: pausesError } = await supabaseAdmin
    .from("plan_pauses")
    .delete()
    .eq("client_id", clientId);
  if (pausesError) {
    return { error: `Не удалось сбросить паузы плана: ${pausesError.message}` };
  }
  return {};
}

export type ClientForInstructions = {
  name: string | null;
  language: string;
  telegram_id: number | null;
  connect_code: string | null;
  timezone: string | null;
};

type ProgramAssignment = {
  clientId: string;
  client: ClientForInstructions;
  programId: string;
  programTitle: string;
  accessEndDate: string;
  coachId: string | null;
};

export async function assignProgramAndNotify(
  input: ProgramAssignment,
): Promise<{
  error?: string;
  connectCode?: string;
  warning?: string;
  programAssigned?: boolean;
}> {
  const resetError = await resetPlanAssignments(input.clientId);
  if (resetError.error) {
    return {
      error: resetError.error,
      programAssigned: true,
    };
  }

  const scheduleError = await generateSchedule(input.clientId, input.programId);
  if (scheduleError.error) {
    return {
      error: `Программа назначена, но не удалось создать расписание: ${scheduleError.error}`,
      programAssigned: true,
    };
  }

  const { connectCode, warning } = await notifyClientForProgram(
    input.clientId,
    input.client,
    input.programTitle,
    input.accessEndDate,
    input.coachId,
  );

  return { connectCode, warning };
}

export async function notifyClientForProgram(
  clientId: string,
  client: ClientForInstructions,
  programTitle: string,
  accessEndDate: string | null,
  coachId: string | null,
): Promise<{ connectCode?: string; warning?: string }> {
  let connectCode: string | null = null;
  if (!client.telegram_id) {
    connectCode =
      resolveConnectCode(client) ?? (await generateConnectCodeFor(clientId));
  }

  const delivery = await deliverProgramInstructions({
    clientId,
    clientName: client.name ?? "",
    clientLanguage: client.language,
    clientTelegramId: client.telegram_id,
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
    name: input.clientName,
    language: input.clientLanguage,
    programTitle: input.programTitle,
    accessEndDate: input.accessEndDate,
    connectCode: input.connectCode,
    botUsername: process.env.TELEGRAM_BOT_USERNAME ?? null,
    timezone: input.timezone,
  });

  const { error: dbError } = await supabaseAdmin.from("messages").insert({
    client_id: input.clientId,
    coach_id: input.coachId,
    direction: "to_client",
    text,
    sent_at: new Date().toISOString(),
    read_at: null,
  });
  if (dbError) {
    console.error("[INSTRUCTIONS] Failed to save message:", dbError.message);
  }

  if (input.clientTelegramId) {
    const sent = await sendTelegramMessage(input.clientTelegramId, text);
    if (!sent) {
      return {
        warning: dbError
          ? "Инструкции не доставлены в Telegram и не сохранены в истории. Проверьте доступность бота и попробуйте ещё раз."
          : "Инструкции не доставлены в Telegram. Проверьте, что клиент не заблокировал бота и что токен бота настроен. Сообщение сохранено в истории чата.",
      };
    }
    return dbError
      ? {
          warning:
            "Инструкции доставлены в Telegram, но не сохранены в истории чата.",
        }
      : {};
  }

  if (input.connectCode) {
    return {
      warning: dbError
        ? "Инструкции не сохранены в истории чата. Передайте клиенту код подключения."
        : "Клиент не подключён к Telegram. Передайте ему код подключения; после подключения отправьте инструкции ещё раз кнопкой «Отправить инструкции».",
    };
  }
  return {
    warning:
      "Клиент не подключён к Telegram, а код подключения не удалось сгенерировать. Попробуйте кнопкой «Код подключения».",
  };
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
  const priceLine =
    price !== null && price !== undefined
      ? `\nЦена: ${formatPrice(price)} ₽`
      : "";
  const amountLine =
    amount !== null && amount !== undefined && amount !== price
      ? `\nСумма оплаты: ${amount.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`
      : "";
  const contactLine = contact
    ? `\n📱 Контакт: ${formatContact(contact)}`
    : telegramId !== null && telegramId !== undefined
      ? `\n🆔 TG ID: ${telegramId}`
      : "";
  const dateLine = `\nДоступ до: ${new Intl.DateTimeFormat("ru-RU").format(new Date(accessEndDate))}`;

  return (
    `✅ Оплата подтверждена\n\n` +
    `Программа: ${programTitle}${priceLine}${amountLine}\n` +
    `Длительность: ${durationWeeks} нед.\n\n` +
    `👤 Клиент: ${clientName}${contactLine}${dateLine}`
  );
}

export type ActivationResult = {
  error?: string;
  connectCode?: string;
  warning?: string;
  programAssigned?: boolean;
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
}): Promise<ActivationResult> {
  if (durationWeeks <= 0)
    return { error: "Некорректная длительность программы" };

  const now = new Date();
  const endDate = new Date(
    now.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000,
  );
  const accessEndDate = endDate.toISOString();

  const { error: updateError } = await supabaseAdmin
    .from("clients")
    .update({
      program_id: programId,
      purchased_program_id: programId,
      payment_status: "paid",
      purchase_date: now.toISOString(),
      status: "active",
      access_start_date: now.toISOString(),
      access_end_date: accessEndDate,
    })
    .eq("id", clientId);
  if (updateError) return { error: updateError.message };

  const assignment = await assignProgramAndNotify({
    clientId,
    client,
    programId,
    programTitle,
    accessEndDate,
    coachId,
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
        accessEndDate,
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

export async function activatePurchaseByOrder({
  orderId,
  coachId,
}: {
  orderId: string;
  coachId: string | null;
}): Promise<
  ActivationResult & {
    alreadyActivated?: boolean;
    requestId?: string;
    clientId?: string;
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
      return { error: "Ошибка при обработке заказа." };
    }
    if (!request) return { error: "Заявка не найдена." };
    if (request.status === "paid") {
      return { alreadyActivated: true, requestId: request.id };
    }
    if (request.status === "cancelled") {
      return { error: "Заявка отменена." };
    }
    if (request.sub_type !== "program") {
      return { error: "Неподдерживаемый тип заявки." };
    }
    if (request.program_id === null) {
      return { error: "Программа недоступна для активации." };
    }

    const { data: program, error: programError } = await supabaseAdmin
      .from("programs")
      .select("id, title, price, duration_weeks")
      .eq("id", request.program_id)
      .eq("active", true)
      .maybeSingle();
    if (programError) {
      console.error("[ACTIVATION] Program lookup error:", programError.message);
      return { error: "Ошибка при проверке программы." };
    }
    if (!program) return { error: "Программа недоступна для активации." };
    if (program.duration_weeks <= 0) {
      return { error: "Некорректная длительность программы" };
    }

    let clientId = request.client_id;
    let client: ClientForInstructions | null = null;

    if (
      !clientId &&
      request.telegram_id !== null &&
      request.telegram_id !== undefined
    ) {
      const { data: existing, error: lookupError } = await supabaseAdmin
        .from("clients")
        .select("id, name, language, telegram_id, connect_code, timezone")
        .eq("telegram_id", request.telegram_id)
        .maybeSingle();
      if (lookupError) {
        console.error("[ACTIVATION] Client lookup error:", lookupError.message);
        return { error: "Ошибка при поиске клиента." };
      }
      clientId = existing?.id ?? null;
      client = existing as ClientForInstructions | null;
    }

    if (clientId && !client) {
      const { data: c, error: cErr } = await supabaseAdmin
        .from("clients")
        .select("id, name, language, telegram_id, connect_code, timezone")
        .eq("id", clientId)
        .maybeSingle();
      if (cErr) {
        console.error("[ACTIVATION] Client lookup error:", cErr.message);
        return { error: "Ошибка при поиске клиента." };
      }
      client = c as ClientForInstructions | null;
    }

    if (!clientId || !client) {
      const now = new Date();
      const endDate = new Date(
        now.getTime() + program.duration_weeks * 7 * 24 * 60 * 60 * 1000,
      );
      const name =
        [request.first_name, request.last_name]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        request.name ||
        "Клиент";
      const consentAt = request.consent_at ?? null;

      const { data: created, error: createError } = await supabaseAdmin
        .from("clients")
        .insert({
          name,
          telegram_id: request.telegram_id,
          status: "active",
          payment_status: "paid",
          program_id: request.program_id,
          purchased_program_id: request.program_id,
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
          .select("id, name, language, telegram_id, connect_code, timezone")
          .eq("telegram_id", request.telegram_id)
          .maybeSingle();
        if (lookupError) {
          console.error(
            "[ACTIVATION] Client lookup error:",
            lookupError.message,
          );
          return { error: "Ошибка при поиске клиента." };
        }
        clientId = existing?.id ?? null;
        client = existing as ClientForInstructions | null;
      } else if (createError) {
        console.error(
          "[ACTIVATION] Client creation failed:",
          createError.message,
        );
        return { error: "Не удалось создать карточку клиента." };
      } else {
        clientId = created?.id ?? null;
        client = {
          name,
          language: "ru",
          telegram_id: request.telegram_id,
          connect_code: null,
          timezone: "UTC",
        };
      }
    }
    if (!clientId || !client) {
      return { error: "Не удалось определить клиента." };
    }

    const { data: claimed, error: claimError } = await supabaseAdmin
      .from("purchase_requests")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        client_id: clientId,
      })
      .eq("id", request.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (claimError) {
      console.error("[ACTIVATION] Claim failed:", claimError.message);
      return { error: "Ошибка обновления статуса заказа." };
    }
    if (!claimed) {
      const { data: current } = await supabaseAdmin
        .from("purchase_requests")
        .select("status")
        .eq("id", request.id)
        .maybeSingle();
      if (current?.status === "paid") {
        return { alreadyActivated: true, requestId: request.id, clientId };
      }
      return {
        error: "Заявка уже была обработана.",
        requestId: request.id,
        clientId,
      };
    }

    const activation = await applyProgramActivation({
      clientId,
      client,
      programId: program.id,
      programTitle: program.title,
      price: typeof program.price === "number" ? program.price : null,
      durationWeeks: program.duration_weeks,
      amount: request.amount,
      contact: request.contact,
      coachId,
    });
    if (activation.error) {
      const { error: revertError } = await supabaseAdmin
        .from("purchase_requests")
        .update({ status: "pending", paid_at: null })
        .eq("id", request.id)
        .eq("status", "paid")
        .eq("client_id", clientId);
      if (revertError) {
        console.error(
          "[ACTIVATION] Claim rollback failed:",
          revertError.message,
        );
      }
      return { ...activation, requestId: request.id, clientId };
    }

    return { ...activation, requestId: request.id, clientId };
  } catch (e) {
    console.error("[ACTIVATION] activatePurchaseByOrder error:", e);
    return { error: "Произошла ошибка при активации." };
  }
}
