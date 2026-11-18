"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifySession } from "@/lib/dal";
import type { Database, PaymentStatus } from "@/types/supabase";
import { TIMEZONE_LIST, LANGUAGE_LABELS, isQuarterTime } from "@/lib/clients";
import { sendTelegramMessage } from "@/lib/telegram";
import { resolvePaymentUrl } from "@/lib/prodamus";
import { PRIVACY_POLICY_VERSION } from "@/lib/consent";
import {
  CLIENT_TOKEN_EXPIRY_DAYS,
  generateClientTokenValue,
  hashClientToken,
} from "@/lib/client-token";
import {
  archivePlanAssignments,
  notifyClientForProgram,
  generateConnectCodeFor,
  applyProgramActivation,
  toFiniteNumber,
} from "@/lib/activate-purchase";
import { startProgramPeriod } from "@/lib/program-periods";
import type { ActivityEvent } from "./activity-types";
import { ACTIVITY_PAGE_SIZE } from "./activity-types";

type RawWorkout = {
  id: string;
  created_at: string;
  exercise: string;
  sets: number | null;
  reps: string | null;
  weight: number | null;
};
type RawNotification = {
  id: string;
  created_at: string;
  type: string;
  status: string;
};

const PER_TABLE_SIZE = 15;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fetchPage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientId: string,
  offset: number,
): Promise<ActivityEvent[]> {
  const from = offset;
  const to = offset + PER_TABLE_SIZE - 1;

  const [workouts, notifications] = await Promise.all([
    supabase
      .from("workout_logs")
      .select("id, created_at, exercise, sets, reps, weight")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .range(from, to),
    supabase
      .from("notification_log")
      .select("id, created_at, type, status")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .range(from, to),
  ]);

  const all: ActivityEvent[] = [];

  for (const w of (workouts.data ?? []) as RawWorkout[]) {
    all.push({
      id: w.id,
      date: w.created_at,
      event_type: "workout",
      details: {
        exercise: w.exercise,
        sets: w.sets,
        reps: w.reps,
        weight: w.weight,
      },
    });
  }
  for (const n of (notifications.data ?? []) as RawNotification[]) {
    all.push({
      id: n.id,
      date: n.created_at,
      event_type: "notification",
      details: { type: n.type, status: n.status },
    });
  }

  all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return all.slice(0, ACTIVITY_PAGE_SIZE);
}

export async function getClientActivity(clientId: string): Promise<
  { events: ActivityEvent[] } | { error: string }
> {
  const { profile } = await verifySession();
  if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
    return { error: "Нет прав" };
  }
  if (!UUID_RE.test(clientId)) {
    return { error: "Некорректный идентификатор" };
  }

  const supabase = await createClient();
  const events = await fetchPage(supabase, clientId, 0);

  return { events };
}

export async function loadMoreActivity(
  clientId: string,
  offset: number,
): Promise<ActivityEvent[] | { error: string }> {
  const { profile } = await verifySession();
  if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
    return { error: "Нет прав" };
  }
  if (!UUID_RE.test(clientId)) {
    return { error: "Некорректный идентификатор" };
  }

  const supabase = await createClient();
  return fetchPage(supabase, clientId, offset);
}

export async function getActivePrograms(clientId: string) {
  const { profile } = await verifySession();
  if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
    return [];
  }
  if (!UUID_RE.test(clientId)) return [];
  const { data, error } = await supabaseAdmin
    .from("programs")
    .select("id, title, active, type")
    .eq("active", true)
    .or(`type.eq.template,client_id.eq.${clientId}`)
    .order("title");
  if (error) {
    console.error("getActivePrograms failed:", error.message);
    return [];
  }
  return data ?? [];
}

export async function getPayablePrograms(): Promise<
  { id: string; title: string; price: number | null }[]
> {
  const { profile } = await verifySession();
  if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
    return [];
  }
  const { data, error } = await supabaseAdmin
    .from("programs")
    .select("id, title, price")
    .eq("active", true)
    .eq("type", "template")
    .is("client_id", null)
    .gt("price", 0)
    .order("title");
  if (error) {
    console.error("getPayablePrograms failed:", error.message);
    return [];
  }
  return data ?? [];
}

export async function activateProgram(
  clientId: string,
  programId: string,
): Promise<{
  error?: string;
  connectCode?: string;
  warning?: string;
  programAssigned?: boolean;
}> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }
    if (!UUID_RE.test(clientId)) return { error: "Некорректный идентификатор" };

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select(
        "id, name, telegram_id, language, connect_code, payment_status, program_id, access_end_date, timezone",
      )
      .eq("id", clientId)
      .maybeSingle();
    if (!client) return { error: "Клиент не найден" };
    if (client.payment_status !== "paid") {
      return { error: "Сначала подтвердите оплату" };
    }

    const { data: program } = await supabaseAdmin
      .from("programs")
      .select("id, title, duration_weeks, type, client_id")
      .eq("id", programId)
      .maybeSingle();
    if (!program) return { error: "Программа не найдена" };
    if (program.client_id !== null && program.client_id !== clientId) {
      return { error: "Программа принадлежит другому клиенту" };
    }
    if (program.type === "personal" && program.client_id === null) {
      return { error: "Личная программа не привязана к клиенту" };
    }
    if (program.duration_weeks <= 0)
      return { error: "Некорректная длительность программы" };

    const now = new Date();
    const endDate = new Date(
      now.getTime() + program.duration_weeks * 7 * 24 * 60 * 60 * 1000,
    );

    // Хвост 30.6-5: период и расписание переключает RPC; только после
    // успешного RPC обновляем строку клиента, иначе ошибка RPC оставила бы
    // program_id без периода. Уведомление отправляем последним: клиент не
    // должен получить сообщение о датах, которых нет в базе.
    const periodResult = await startProgramPeriod(clientId, programId);
    if (periodResult.error) {
      console.error(
        "[ASSIGN_PROGRAM] period switch failed:",
        periodResult.error,
      );
      return { error: periodResult.error, programAssigned: true };
    }

    const { error } = await supabaseAdmin
      .from("clients")
      .update({
        program_id: programId,
        purchase_date: now.toISOString(),
        status: "active",
        access_start_date: now.toISOString(),
        access_end_date: endDate.toISOString(),
      })
      .eq("id", clientId);
    if (error) return { error: error.message };

    const assignment = await notifyClientForProgram(
      clientId,
      client,
      program.title,
      endDate.toISOString(),
      profile.id,
    );

    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/clients");
    return assignment;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

export async function sendProgramInstructions(
  clientId: string,
): Promise<{ error?: string; connectCode?: string; warning?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }
    if (!UUID_RE.test(clientId)) return { error: "Некорректный идентификатор" };

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select(
        "id, name, telegram_id, language, connect_code, program_id, access_end_date, payment_status, timezone",
      )
      .eq("id", clientId)
      .maybeSingle();
    if (!client) return { error: "Клиент не найден" };
    if (!client.program_id) return { error: "Сначала назначьте программу" };
    if (client.payment_status !== "paid") {
      return { error: "Сначала подтвердите оплату" };
    }

    const { data: program } = await supabaseAdmin
      .from("programs")
      .select("title")
      .eq("id", client.program_id)
      .maybeSingle();
    if (!program) return { error: "Программа не найдена" };

    const { connectCode, warning } = await notifyClientForProgram(
      clientId,
      client,
      program.title,
      client.access_end_date,
      profile.id,
    );

    revalidatePath(`/clients/${clientId}`);
    return { connectCode, warning };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

export async function generateConnectCode(
  clientId: string,
): Promise<{ error?: string; code?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }
    if (!UUID_RE.test(clientId)) return { error: "Некорректный идентификатор" };

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("id", clientId)
      .maybeSingle();
    if (!client) return { error: "Клиент не найден" };

    const code = await generateConnectCodeFor(clientId);
    if (!code) return { error: "Не удалось сгенерировать уникальный код" };

    revalidatePath(`/clients/${clientId}`);
    return { code };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

export async function generateClientToken(
  clientId: string,
): Promise<{ error?: string; token?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }
    if (!UUID_RE.test(clientId)) return { error: "Некорректный идентификатор" };

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("id", clientId)
      .maybeSingle();
    if (!client) return { error: "Клиент не найден" };

    const expiresAt = new Date(
      Date.now() + CLIENT_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    for (let i = 0; i < 5; i++) {
      const token = generateClientTokenValue();
      const { error } = await supabaseAdmin.rpc("create_client_token", {
        p_client_id: clientId,
        p_token_hash: hashClientToken(token),
        p_expires_at: expiresAt,
      });
      if (!error) {
        revalidatePath(`/clients/${clientId}`);
        return { token };
      }
      if (error.code !== "23505") return { error: error.message };
    }

    return { error: "Не удалось сгенерировать уникальный токен" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

export async function disableClient(
  clientId: string,
): Promise<{ error?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }
    if (!UUID_RE.test(clientId)) return { error: "Некорректный идентификатор" };

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("status")
      .eq("id", clientId)
      .maybeSingle();
    if (!client) return { error: "Клиент не найден" };
    if (client.status === "inactive" || client.status === "access_expired") {
      return { error: "Клиент уже отключён" };
    }

    // 30.8: подписка - источник истины для доступа. Отключение гасит живую
    // подписку (active/past_due → cancelled), иначе неактивный клиент с
    // живой подпиской мог бы бесконечно переключать программы в боте.
    // Отмена обязательна: не задавленная подписка переживёт disable, а
    // повторная покупка потом упрётся в unique live-подписку.
    const { error: subCancelError } = await supabaseAdmin
      .from("subscriptions")
      .update({ status: "cancelled" })
      .eq("client_id", clientId)
      .in("status", ["active", "past_due"]);
    if (subCancelError) {
      console.error(
        "[DISABLE] Subscription cancel failed:",
        subCancelError.message,
      );
      return {
        error: "Не удалось отменить подписку клиента. Попробуйте ещё раз.",
      };
    }

    const { error } = await supabaseAdmin
      .from("clients")
      .update({
        status: "inactive",
        program_id: null,
        purchase_date: null,
        access_start_date: null,
        access_end_date: null,
      })
      .eq("id", clientId);
    if (error) return { error: error.message };

    const archiveError = await archivePlanAssignments(clientId);
    if (archiveError.error) {
      revalidatePath(`/clients/${clientId}`);
      revalidatePath("/clients");
      return { error: archiveError.error };
    }

    // Хвост 30.5 + 30.6-2: отключение закрывает активный период SQL-функцией
    // (ended_at считает БД, а не часы приложения).
    const { error: periodCloseError } = await supabaseAdmin.rpc(
      "close_active_period",
      { p_client_id: clientId },
    );
    if (periodCloseError) {
      console.error("[DISABLE] Period close failed:", periodCloseError.message);
    }

    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/clients");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

export async function deleteClient(
  clientId: string,
  force = false,
): Promise<{ error?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }

    if (!UUID_RE.test(clientId)) return { error: "Некорректный идентификатор" };

    const { data: client, error: clientError } = await supabaseAdmin
      .from("clients")
      .select("id, telegram_id, spreadsheet_id")
      .eq("id", clientId)
      .maybeSingle();
    if (clientError) {
      console.error("deleteClient: client lookup failed:", clientError.message);
      return { error: "Не удалось загрузить клиента. Повторите попытку." };
    }
    if (!client) {
      return {};
    }

    if (client.spreadsheet_id && !force) {
      return {
        error:
          "У клиента есть файлы в Google Drive/Sheets. Удалите их вручную и повторите с подтверждением.",
      };
    }

    const { error } = await supabaseAdmin.rpc("delete_client_cascade", {
      p_client_id: clientId,
      p_telegram_id: client.telegram_id ?? null,
    });
    if (error) return { error: error.message };

    revalidatePath("/clients");
    revalidatePath(`/clients/${clientId}`);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

export async function togglePayment(
  clientId: string,
  currentStatus: PaymentStatus,
): Promise<{ error?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }
    if (!UUID_RE.test(clientId)) return { error: "Некорректный идентификатор" };

    const nextStatus: PaymentStatus =
      currentStatus === "paid" ? "pending" : "paid";

    const { error } = await supabaseAdmin
      .from("clients")
      .update({ payment_status: nextStatus })
      .eq("id", clientId);
    if (error) return { error: error.message };

    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/clients");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

export async function resetExerciseSwap(
  clientId: string,
  swapId: string,
): Promise<{ error?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }
    if (!UUID_RE.test(clientId) || !UUID_RE.test(swapId)) {
      return { error: "Некорректный идентификатор" };
    }

    const { error } = await supabaseAdmin
      .from("client_exercise_swaps")
      .delete()
      .eq("id", swapId)
      .eq("client_id", clientId);
    if (error) return { error: error.message };

    revalidatePath(`/clients/${clientId}`);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

export async function markPurchased(
  clientId: string,
  programId: string,
): Promise<{
  error?: string;
  connectCode?: string;
  warning?: string;
  programAssigned?: boolean;
}> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }
    if (!UUID_RE.test(clientId)) return { error: "Некорректный идентификатор" };
    if (!UUID_RE.test(programId)) {
      return { error: "Некорректный идентификатор программы" };
    }

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select(
        "id, name, telegram_id, language, connect_code, program_id, access_end_date, timezone",
      )
      .eq("id", clientId)
      .maybeSingle();
    if (!client) return { error: "Клиент не найден" };

    const { data: program } = await supabaseAdmin
      .from("programs")
      .select("id, title, price, duration_weeks, type, client_id")
      .eq("id", programId)
      .maybeSingle();
    if (!program) return { error: "Программа не найдена" };
    if (program.client_id !== null && program.client_id !== clientId) {
      return { error: "Программа принадлежит другому клиенту" };
    }
    if (program.type === "personal" && program.client_id === null) {
      return { error: "Личная программа не привязана к клиенту" };
    }

    const activation = await applyProgramActivation({
      clientId,
      client,
      programId,
      programTitle: program.title,
      price: toFiniteNumber(program.price),
      durationWeeks: program.duration_weeks,
      amount: null,
      contact: null,
      coachId: profile.id,
    });

    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/clients");
    return activation;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

// ─── Ссылка на оплату (Продамус) ─────────────────────────────────────────────

function getPayformBaseUrl(): string | null {
  const raw = process.env.PRODAMUS_PAYFORM_BASE_URL;
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return null;
    // trailing slash не влияет на URL()/searchParams, но нормализуем для чистоты
    return raw.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

type PendingRequest = {
  id: string;
  client_id: string | null;
  amount: number | null;
};

async function findPendingProgramRequest(
  clientId: string,
  telegramId: number | null,
  programId: string,
): Promise<PendingRequest | null> {
  const byClient = await supabaseAdmin
    .from("purchase_requests")
    .select("id, client_id, amount")
    .eq("status", "pending")
    .eq("program_id", programId)
    .eq("client_id", clientId)
    .limit(1)
    .maybeSingle();
  if (byClient.data) return byClient.data as PendingRequest;

  if (telegramId == null) return null;
  const byTelegram = await supabaseAdmin
    .from("purchase_requests")
    .select("id, client_id, amount")
    .eq("status", "pending")
    .eq("program_id", programId)
    .eq("telegram_id", telegramId)
    .limit(1)
    .maybeSingle();
  return (byTelegram.data as PendingRequest) ?? null;
}

async function bindRequestToClient(
  requestId: string,
  clientId: string,
  clientName: string,
): Promise<{ error?: string }> {
  // Guard'ы обязательны: гонка с вебхуком (заявка уже paid) или другим
  // процессом не должна перезаписывать чужие данные. 0 строк = fail-closed.
  const { data, error } = await supabaseAdmin
    .from("purchase_requests")
    .update({ client_id: clientId, name: clientName })
    .eq("id", requestId)
    .is("client_id", null)
    .eq("status", "pending")
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "Заявка уже обработана - обновите страницу" };
  }
  return {};
}

export async function createPaymentLink(
  clientId: string,
  programId: string,
): Promise<{
  error?: string;
  url?: string;
  requestId?: string;
}> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }
    if (!UUID_RE.test(clientId)) return { error: "Некорректный идентификатор" };
    if (!UUID_RE.test(programId)) {
      return { error: "Некорректный идентификатор программы" };
    }

    const payformUrl = getPayformBaseUrl();
    if (!payformUrl) {
      return { error: "Платежи не настроены: отсутствует PRODAMUS_PAYFORM_BASE_URL" };
    }

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id, name, telegram_id, client_consent_given, client_consent_version")
      .eq("id", clientId)
      .maybeSingle();
    if (!client) return { error: "Клиент не найден" };
    if (!client.client_consent_given) {
      return {
        error:
          "Клиент не принял политику конфиденциальности - отправьте согласие через портал или бота",
      };
    }

    const { data: program } = await supabaseAdmin
      .from("programs")
      .select("id, title, price, active, type, client_id")
      .eq("id", programId)
      .maybeSingle();
    if (!program || !program.active) return { error: "Программа не найдена" };
    if (program.client_id !== null && program.client_id !== clientId) {
      return { error: "Программа принадлежит другому клиенту" };
    }
    if (program.type === "personal" && program.client_id === null) {
      return { error: "Личная программа не привязана к клиенту" };
    }

    const price = toFiniteNumber(program.price);
    if (price == null || price <= 0) {
      return { error: "У программы не указана цена" };
    }

    // Переиспользуем pending-заявку (в т.ч. созданную ботом до привязки
    // клиента), иначе упрёмся в unique-индекс по pending.
    let request = await findPendingProgramRequest(clientId, client.telegram_id, programId);
    const ensureBound = async (): Promise<{ error?: string }> => {
      if (!request || request.client_id === clientId) return {};
      if (request.client_id !== null) {
        // Заявка принадлежит другому клиенту панели - не перехватываем её.
        return {
          error:
            "Найдена незавершённая заявка на эту программу от другого профиля клиента. Отмените её в блоке «Оплаты» и попробуйте снова",
        };
      }
      // Заявка бота без привязки - привязываем к текущему клиенту панели,
      // чтобы вебхук/отправка работали по client_id.
      const bind = await bindRequestToClient(request.id, clientId, client.name);
      if (bind.error) return bind;
      request = { ...request, client_id: clientId };
      return {};
    };

    if (!request) {
      const requestId = randomUUID();
      const insert = async () =>
        supabaseAdmin.from("purchase_requests").insert({
          id: requestId,
          order_id: requestId, // order_id = id заявки (конвенция миграции)
          amount: price, // снимок цены на момент создания ссылки
          client_id: clientId,
          program_id: programId,
          name: client.name,
          contact: "panel",
          telegram_id: client.telegram_id,
          sub_type: "program",
          // Согласие: панельная ссылка создаётся тренером для клиента,
          // который УЖЕ принял политику (проверено выше - client_consent_given).
          // Без consent_given=true вебхук отклонил бы активацию уже
          // оплаченной заявки (fail-closed). Фиксируем версию политики клиента.
          consent_given: true,
          consent_at: new Date().toISOString(),
          consent_version: client.client_consent_version ?? PRIVACY_POLICY_VERSION,
        });
      const { error: insertError } = await insert();
      if (insertError?.code === "23505") {
        // Гонка с параллельным созданием/ботом: побеждает существующая
        // pending-заявка - переиспользуем её (bind ниже).
        request = await findPendingProgramRequest(clientId, client.telegram_id, programId);
        if (!request) {
          return { error: "Не удалось создать заявку - обновите страницу" };
        }
      } else if (insertError) {
        return { error: insertError.message };
      } else {
        // insert без .select() данных не возвращает - конструируем из известных полей.
        request = { id: requestId, client_id: clientId, amount: price };
      }
    }
    if (!request) return { error: "Не удалось создать заявку на оплату" };
    const bound = await ensureBound();
    if (bound.error) return bound;

    const amount = toFiniteNumber(request.amount) ?? price;
    if (amount == null || amount <= 0) {
      return { error: "У заявки некорректная сумма - обновите страницу" };
    }
    const linkOpts = {
      payformUrl,
      orderId: request.id,
      amount,
      productName: program.title,
    };
    // Короткая ссылка устойчива к копированию текстом (длинная теряет
    // скобки → у клиента пустая сумма).
    const url = await resolvePaymentUrl(linkOpts);
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/clients");
    return { url, requestId: request.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

export async function createSubscriptionPaymentLink(
  clientId: string,
): Promise<{ url?: string; paymentId?: string; error?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }
    if (!UUID_RE.test(clientId)) return { error: "Некорректный идентификатор" };

    const payformUrl = getPayformBaseUrl();
    if (!payformUrl) {
      return { error: "Платежи не настроены: отсутствует PRODAMUS_PAYFORM_BASE_URL" };
    }

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id, status, telegram_id, client_consent_given")
      .eq("id", clientId)
      .maybeSingle();
    if (!client) return { error: "Клиент не найден" };
    if (!client.client_consent_given) {
      return { error: "Клиент отозвал согласие на обработку данных" };
    }
    if (client.status === "inactive") {
      return { error: "Клиент отключён. Сначала верни доступ" };
    }

    const { data: liveSub } = await supabaseAdmin
      .from("subscriptions")
      .select("id")
      .eq("client_id", clientId)
      .in("status", ["active", "past_due"])
      .limit(1)
      .maybeSingle();
    if (liveSub) {
      return { error: "У клиента уже есть активная подписка" };
    }

    const { data: plan, error: planError } = await supabaseAdmin
      .from("subscription_plans")
      .select("id, title, price, period_days")
      .eq("code", "monthly")
      .eq("active", true)
      .maybeSingle();
    if (planError || !plan) {
      return { error: "Активный тариф подписки не найден" };
    }

    type PendingSub = { id: string } | null;
    type PendingPayment = { id: string; order_id: string | null } | null;

    const loadPendingSub = async (): Promise<PendingSub> => {
      const { data, error } = await supabaseAdmin
        .from("subscriptions")
        .select("id")
        .eq("client_id", clientId)
        .eq("status", "pending")
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error("createSubscriptionLink: pending sub lookup failed:", error.message);
        return null;
      }
      return (data as PendingSub) ?? null;
    };

    const loadPendingPayment = async (subId: string): Promise<PendingPayment> => {
      const { data, error } = await supabaseAdmin
        .from("subscription_payments")
        .select("id, order_id")
        .eq("subscription_id", subId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error("createSubscriptionLink: pending payment lookup failed:", error.message);
        return null;
      }
      return (data as PendingPayment) ?? null;
    };

    type SyncedPayment = { id: string; order_id: string };

    const syncPaymentAmount = async (
      row: NonNullable<PendingPayment>,
    ): Promise<{ payment?: SyncedPayment; error?: string }> => {
      const orderId = row.order_id ?? randomUUID();
      const { data, error } = await supabaseAdmin
        .from("subscription_payments")
        .update({ order_id: orderId, amount: plan.price })
        .eq("id", row.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (error) {
        console.error("createSubscriptionLink: amount sync failed:", error.message);
        return { error: error.message };
      }
      if (!data) return { error: "Ссылка устарела. Попробуй заново" };
      return { payment: { id: row.id, order_id: orderId } };
    };

    let subId = (await loadPendingSub())?.id ?? null;
    if (!subId) {
      const candidateId = randomUUID();
      const { error: subError } = await supabaseAdmin.from("subscriptions").insert({
        id: candidateId,
        client_id: clientId,
        plan_id: plan.id,
        provider: "prodamus",
        status: "pending",
      });
      if (subError?.code === "23505") {
        subId = (await loadPendingSub())?.id ?? null;
        if (!subId) return { error: "Конкурирующая подписка не найдена" };
      } else if (subError) {
        console.error("createSubscriptionLink: sub insert failed:", subError.message);
        return { error: subError.message };
      } else {
        subId = candidateId;
      }
    }
    if (!subId) return { error: "Не удалось создать подписку" };

    const { data: syncedSub, error: planSyncError } = await supabaseAdmin
      .from("subscriptions")
      .update({ plan_id: plan.id })
      .eq("id", subId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (planSyncError) {
      console.error("createSubscriptionLink: plan sync failed:", planSyncError.message);
      return { error: planSyncError.message };
    }
    if (!syncedSub) return { error: "Подписка изменилась. Попробуй заново" };

    let payment: SyncedPayment | null = null;
    const existingPayment = await loadPendingPayment(subId);
    if (existingPayment) {
      const synced = await syncPaymentAmount(existingPayment);
      if (synced.error) return { error: synced.error };
      payment = synced.payment ?? null;
    } else {
      const candidateId = randomUUID();
      const candidateOrderId = randomUUID();
      const { error: paymentError } = await supabaseAdmin
        .from("subscription_payments")
        .insert({
          id: candidateId,
          subscription_id: subId,
          order_id: candidateOrderId,
          amount: plan.price,
          status: "pending",
        });
      if (paymentError?.code === "23505") {
        const raced = await loadPendingPayment(subId);
        if (!raced) return { error: "Конкурирующий платёж не найден" };
        const synced = await syncPaymentAmount(raced);
        if (synced.error) return { error: synced.error };
        payment = synced.payment ?? null;
      } else if (paymentError) {
        console.error("createSubscriptionLink: payment insert failed:", paymentError.message);
        return { error: paymentError.message };
      } else {
        payment = { id: candidateId, order_id: candidateOrderId };
      }
    }
    if (!payment?.order_id) return { error: "Не удалось создать платеж" };

    const url = await resolvePaymentUrl({
      payformUrl,
      orderId: payment.order_id,
      amount: plan.price,
      productName: plan.title,
    });
    revalidatePath(`/clients/${clientId}`);
    return { url, paymentId: payment.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

export async function sendSubscriptionLinkToClient(
  clientId: string,
  paymentId: string,
): Promise<{ error?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }
    if (!UUID_RE.test(clientId) || !UUID_RE.test(paymentId)) {
      return { error: "Некорректный идентификатор" };
    }
    const payformUrl = getPayformBaseUrl();
    if (!payformUrl) return { error: "Платежи не настроены" };

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id, status, telegram_id, client_consent_given")
      .eq("id", clientId)
      .maybeSingle();
    if (!client) return { error: "Клиент не найден" };
    if (client.status === "inactive") return { error: "Клиент отключён. Сначала верни доступ" };
    if (client.telegram_id == null) return { error: "Клиент не подключён к боту" };
    if (!client.client_consent_given) {
      return { error: "Клиент отозвал согласие на обработку данных" };
    }

    const { data: payment } = await supabaseAdmin
      .from("subscription_payments")
      .select("id, order_id, amount, status, subscriptions!inner(client_id, status)")
      .eq("id", paymentId)
      .eq("subscriptions.client_id", clientId)
      .maybeSingle();
    if (!payment || payment.status !== "pending") {
      return { error: "Активная ссылка на подписку не найдена" };
    }
    if (!payment.order_id) return { error: "У платежа нет order_id" };

    const dedupKey = `sub_link:${paymentId}`;
    const { error: purgeError } = await supabaseAdmin
      .from("bot_dedup")
      .delete()
      .eq("key", dedupKey)
      .lt("expires_at", new Date().toISOString());
    if (purgeError) {
      console.error("sendSubscriptionLink: purge failed:", purgeError.message);
    }
    const { error: dedupError } = await supabaseAdmin.from("bot_dedup").insert({
      key: dedupKey,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    if (dedupError?.code === "23505") {
      return { error: "Ссылка только что была отправлена - подождите минуту" };
    }
    if (dedupError) {
      console.error("sendSubscriptionLink: dedup failed:", dedupError.message);
    }

    const url = await resolvePaymentUrl({
      payformUrl,
      orderId: payment.order_id,
      amount: Number(payment.amount),
      productName: "Подписка на все программы",
    });
    const amount = Number(payment.amount).toLocaleString("ru-RU");
    const sent = await sendTelegramMessage(
      client.telegram_id,
      `Оплата подписки на все программы (${amount} ₽):\n\n${url}`,
    );
    if (!sent) {
      await supabaseAdmin.from("bot_dedup").delete().eq("key", dedupKey);
      return { error: "Не удалось отправить сообщение в Telegram" };
    }
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

export async function cancelClientSubscription(
  clientId: string,
): Promise<{ error?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }
    if (!UUID_RE.test(clientId)) return { error: "Некорректный идентификатор" };

    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("id, current_period_end, cancel_at_period_end")
      .eq("client_id", clientId)
      .in("status", ["active", "past_due"])
      .limit(1)
      .maybeSingle();
    if (!sub) return { error: "Активной подписки нет" };
    if (sub.cancel_at_period_end) {
      return { error: "Отмена подписки уже запланирована" };
    }
    if (!sub.current_period_end) {
      return { error: "У подписки нет даты окончания периода" };
    }

    const { error } = await supabaseAdmin
      .from("subscriptions")
      .update({ cancel_at_period_end: true, next_payment_at: null })
      .eq("id", sub.id)
      .eq("cancel_at_period_end", false);
    if (error) return { error: error.message };

    const { scheduleImmediateExpiryNotice } = await import("@/lib/subscription-billing");
    await scheduleImmediateExpiryNotice(sub.id, clientId, sub.current_period_end);
    revalidatePath(`/clients/${clientId}`);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

export async function sendPaymentLinkToClient(
  clientId: string,
  requestId: string,
): Promise<{ error?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }
    if (!UUID_RE.test(clientId) || !UUID_RE.test(requestId)) {
      return { error: "Некорректный идентификатор" };
    }

    const payformUrl = getPayformBaseUrl();
    if (!payformUrl) {
      return { error: "Платежи не настроены: отсутствует PRODAMUS_PAYFORM_BASE_URL" };
    }

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id, telegram_id, client_consent_given")
      .eq("id", clientId)
      .maybeSingle();
    if (!client) return { error: "Клиент не найден" };
    if (client.telegram_id == null) {
      return { error: "Клиент не подключён к боту" };
    }
    if (!client.client_consent_given) {
      return { error: "Клиент отозвал согласие на обработку данных" };
    }

    const { data: request } = await supabaseAdmin
      .from("purchase_requests")
      .select("id, amount, status, program:programs!purchase_requests_program_id_fkey(title)")
      .eq("id", requestId)
      .eq("client_id", clientId)
      .maybeSingle();
    if (!request || request.status !== "pending") {
      return { error: "Активная заявка не найдена - создайте ссылку заново" };
    }

    const programTitle =
      request.program && !Array.isArray(request.program) && typeof request.program === "object"
        ? (request.program as { title?: string }).title ?? "Программа"
        : "Программа";
    const amount = toFiniteNumber(request.amount);
    if (amount == null || amount <= 0) {
      return { error: "У заявки некорректная сумма - создайте ссылку заново" };
    }

    // Троттлинг повторных отправок (защита от спама клиенту): одна отправка
    // на заявку в минуту.
    const sendDedupKey = `send_link:${requestId}`;
    const { error: sendPurgeError } = await supabaseAdmin
      .from("bot_dedup")
      .delete()
      .eq("key", sendDedupKey)
      .lt("expires_at", new Date().toISOString());
    if (sendPurgeError) {
      console.error("sendPaymentLinkToClient: purge dedup failed:", sendPurgeError.message);
    }
    const { error: sendDedupError } = await supabaseAdmin
      .from("bot_dedup")
      .insert({
        key: sendDedupKey,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
    if (sendDedupError?.code === "23505") {
      return { error: "Ссылка только что была отправлена - подождите минуту" };
    }
    if (sendDedupError) {
      console.error("sendPaymentLinkToClient: dedup write failed:", sendDedupError.message);
    }

    const linkOpts = {
      payformUrl,
      orderId: request.id,
      amount,
      productName: programTitle,
    };
    const url = await resolvePaymentUrl(linkOpts);

    const amountText = ` (${amount.toLocaleString("ru-RU")} ₽)`;
    const sent = await sendTelegramMessage(
      client.telegram_id,
      `Оплата программы «${programTitle}»${amountText}:\n\n${url}`,
    );
    if (!sent) {
      // Снимаем троттлинг, чтобы тренер мог повторить отправку сразу
      await supabaseAdmin.from("bot_dedup").delete().eq("key", sendDedupKey);
      return { error: "Не удалось отправить сообщение в Telegram" };
    }
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

export async function updateClient(
  clientId: string,
  data: {
    name?: string;
    language?: string;
    timezone?: string | null;
    morning_time?: string | null;
    training_days?: number[] | null;
  },
): Promise<{ error?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }

    const update: Database["public"]["Tables"]["clients"]["Update"] = {};

    if (data.name !== undefined) {
      const trimmed = data.name.trim();
      if (!trimmed) return { error: "Имя не может быть пустым" };
      if (trimmed.length > 200) return { error: "Имя слишком длинное" };
      update.name = trimmed;
    }

    if (data.language !== undefined) {
      if (!(Object.keys(LANGUAGE_LABELS) as string[]).includes(data.language)) {
        return { error: "Некорректный язык" };
      }
      update.language = data.language;
    }

    if (data.timezone !== undefined) {
      if (data.timezone !== null && data.timezone !== "") {
        if (!(TIMEZONE_LIST as readonly string[]).includes(data.timezone)) {
          return { error: "Некорректный часовой пояс" };
        }
        update.timezone = data.timezone;
      } else {
        update.timezone = null;
      }
    }

    if (data.morning_time !== undefined) {
      if (data.morning_time !== null && data.morning_time !== "") {
        if (!isQuarterTime(data.morning_time)) {
          return {
            error:
              "Время утреннего напоминания должно быть с шагом 15 минут (00, 15, 30, 45)",
          };
        }
        update.morning_time = data.morning_time;
      } else {
        update.morning_time = null;
      }
    }

    if (data.training_days !== undefined) {
      if (data.training_days !== null) {
        if (
          !Array.isArray(data.training_days) ||
          data.training_days.length === 0 ||
          data.training_days.some(
            (d) => !Number.isInteger(d) || d < 1 || d > 7,
          ) ||
          new Set(data.training_days).size !== data.training_days.length
        ) {
          return { error: "Некорректный список тренировочных дней" };
        }
        update.training_days = data.training_days;
      } else {
        update.training_days = null;
      }
    }

    if (Object.keys(update).length === 0) {
      return { error: "Нет данных для обновления" };
    }

    const { data: existing } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("id", clientId)
      .maybeSingle();
    if (!existing) return { error: "Клиент не найден" };

    const { error } = await supabaseAdmin
      .from("clients")
      .update(update)
      .eq("id", clientId);
    if (error) return { error: error.message };

    if (update.training_days !== undefined) {
      const { error: scheduleError } = await supabaseAdmin
        .from("program_schedule")
        .update({ training_days: update.training_days })
        .eq("client_id", clientId)
        .neq("status", "archived");

      if (scheduleError) return { error: scheduleError.message };
    }

    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/clients");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}
