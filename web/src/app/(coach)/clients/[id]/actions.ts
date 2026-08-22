"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifySession } from "@/lib/dal";
import type { Database, PaymentStatus } from "@/types/supabase";
import { TIMEZONE_LIST, LANGUAGE_LABELS, isQuarterTime } from "@/lib/clients";
import { sendTelegramMessage } from "@/lib/telegram";
import { buildPaymentUrl } from "@/lib/prodamus";
import { PRIVACY_POLICY_VERSION } from "@/lib/consent";
import {
  resetPlanAssignments,
  assignProgramAndNotify,
  notifyClientForProgram,
  generateConnectCodeFor,
  applyProgramActivation,
  toFiniteNumber,
  type ClientForInstructions,
} from "@/lib/activate-purchase";
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
type RawCheckin = {
  id: string;
  created_at: string;
  wellbeing: number | null;
  sleep: number | null;
  stress: number | null;
};
type RawMeasurement = {
  id: string;
  created_at: string;
  weight: number | null;
  waist: number | null;
  chest: number | null;
  hips: number | null;
};
// type RawPhoto = { id: string; created_at: string; type: string }; // DISABLED: photo storage removed
type RawMessage = {
  id: string;
  created_at: string;
  direction: string;
  text: string;
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

  const [workouts, checkins, measurements, messages, notifications] =
    await Promise.all([
      supabase
        .from("workout_logs")
        .select("id, created_at, exercise, sets, reps, weight")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .range(from, to),
      supabase
        .from("checkins")
        .select("id, created_at, wellbeing, sleep, stress")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .range(from, to),
      supabase
        .from("measurements")
        .select("id, created_at, weight, waist, chest, hips")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .range(from, to),
      // supabase.from("photos").select("id, created_at, type").eq("client_id", clientId).order("created_at", { ascending: false }).range(from, to), // DISABLED: photo storage removed
      supabase
        .from("messages")
        .select("id, created_at, direction, text")
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
  for (const c of (checkins.data ?? []) as RawCheckin[]) {
    all.push({
      id: c.id,
      date: c.created_at,
      event_type: "checkin",
      details: { wellbeing: c.wellbeing, sleep: c.sleep, stress: c.stress },
    });
  }
  for (const m of (measurements.data ?? []) as RawMeasurement[]) {
    all.push({
      id: m.id,
      date: m.created_at,
      event_type: "measurement",
      details: {
        weight: m.weight,
        waist: m.waist,
        chest: m.chest,
        hips: m.hips,
      },
    });
  }
  // DISABLED: photo storage removed
  // for (const p of (photos.data ?? []) as RawPhoto[]) {
  //   all.push({ id: p.id, date: p.created_at, event_type: "photo", details: { type: p.type } });
  // }
  for (const msg of (messages.data ?? []) as RawMessage[]) {
    all.push({
      id: msg.id,
      date: msg.created_at,
      event_type: "message",
      details: { direction: msg.direction, preview: msg.text },
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

export async function getClientActivity(clientId: string): Promise<{
  events: ActivityEvent[];
}> {
  const supabase = await createClient();
  const events = await fetchPage(supabase, clientId, 0);

  return { events };
}

export async function loadMoreActivity(
  clientId: string,
  offset: number,
): Promise<ActivityEvent[]> {
  const supabase = await createClient();
  return fetchPage(supabase, clientId, offset);
}

export async function getActivePrograms() {
  const { profile } = await verifySession();
  if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
    return [];
  }
  const { data } = await supabaseAdmin
    .from("programs")
    .select("id, title, active, type")
    .eq("active", true)
    .order("title");
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
      .select("id, title, duration_weeks")
      .eq("id", programId)
      .maybeSingle();
    if (!program) return { error: "Программа не найдена" };
    if (program.duration_weeks <= 0)
      return { error: "Некорректная длительность программы" };

    const now = new Date();
    const endDate = new Date(
      now.getTime() + program.duration_weeks * 7 * 24 * 60 * 60 * 1000,
    );

    const { error } = await supabaseAdmin
      .from("clients")
      .update({
        program_id: programId,
        purchased_program_id: programId,
        purchase_date: now.toISOString(),
        status: "active",
        access_start_date: now.toISOString(),
        access_end_date: endDate.toISOString(),
      })
      .eq("id", clientId);
    if (error) return { error: error.message };

    const assignment = await assignProgramAndNotify({
      clientId,
      client,
      programId,
      programTitle: program.title,
      accessEndDate: endDate.toISOString(),
      coachId: profile.id,
    });

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

// ⚠️ MUST stay in sync with bot/src/handlers/my-web.ts
// TODO: Extract to shared lib when monorepo tooling is available
const TOKEN_EXPIRY_DAYS = 30;
const TOKEN_LENGTH = 16;
const TOKEN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function generateToken(length: number): string {
  let token = "";
  while (token.length < length) {
    const byte = crypto.getRandomValues(new Uint8Array(1))[0];
    if (byte < 252) {
      token += TOKEN_CHARS[byte % TOKEN_CHARS.length];
    }
  }
  return token;
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

    const { error: deleteError } = await supabaseAdmin
      .from("client_tokens")
      .delete()
      .eq("client_id", clientId);
    if (deleteError) return { error: deleteError.message };

    const expiresAt = new Date(
      Date.now() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    for (let i = 0; i < 5; i++) {
      const token = generateToken(TOKEN_LENGTH);
      const { error } = await supabaseAdmin.from("client_tokens").insert({
        client_id: clientId,
        token,
        expires_at: expiresAt,
        last_used_at: null,
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

    const { error } = await supabaseAdmin
      .from("clients")
      .update({
        status: "inactive",
        program_id: null,
        purchased_program_id: null,
        purchase_date: null,
        access_start_date: null,
        access_end_date: null,
      })
      .eq("id", clientId);
    if (error) return { error: error.message };

    const resetError = await resetPlanAssignments(clientId);
    if (resetError.error) {
      revalidatePath(`/clients/${clientId}`);
      revalidatePath("/clients");
      return { error: resetError.error };
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
): Promise<{ error?: string }> {
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

    const { error } = await supabaseAdmin
      .from("clients")
      .delete()
      .eq("id", clientId);
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
      .select("id, title, price, duration_weeks")
      .eq("id", programId)
      .maybeSingle();
    if (!program) return { error: "Программа не найдена" };

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
    return { error: "Заявка уже обработана — обновите страницу" };
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
          "Клиент не принял политику конфиденциальности — отправьте согласие через портал или бота",
      };
    }

    const { data: program } = await supabaseAdmin
      .from("programs")
      .select("id, title, price, active")
      .eq("id", programId)
      .maybeSingle();
    if (!program || !program.active) return { error: "Программа не найдена" };

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
        // Заявка принадлежит другому клиенту панели — не перехватываем её.
        return {
          error:
            "Найдена незавершённая заявка на эту программу от другого профиля клиента. Отмените её в блоке «Оплаты» и попробуйте снова",
        };
      }
      // Заявка бота без привязки — привязываем к текущему клиенту панели,
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
          // который УЖЕ принял политику (проверено выше — client_consent_given).
          // Без consent_given=true вебхук отклонил бы активацию уже
          // оплаченной заявки (fail-closed). Фиксируем версию политики клиента.
          consent_given: true,
          consent_at: new Date().toISOString(),
          consent_version: client.client_consent_version ?? PRIVACY_POLICY_VERSION,
        });
      const { error: insertError } = await insert();
      if (insertError?.code === "23505") {
        // Гонка с параллельным созданием/ботом: побеждает существующая
        // pending-заявка — переиспользуем её (bind ниже).
        request = await findPendingProgramRequest(clientId, client.telegram_id, programId);
        if (!request) {
          return { error: "Не удалось создать заявку — обновите страницу" };
        }
      } else if (insertError) {
        return { error: insertError.message };
      } else {
        // insert без .select() данных не возвращает — конструируем из известных полей.
        request = { id: requestId, client_id: clientId, amount: price };
      }
    }
    if (!request) return { error: "Не удалось создать заявку на оплату" };
    const bound = await ensureBound();
    if (bound.error) return bound;

    const amount = toFiniteNumber(request.amount) ?? price;
    if (amount == null || amount <= 0) {
      return { error: "У заявки некорректная сумма — обновите страницу" };
    }
    const url = buildPaymentUrl({
      payformUrl,
      orderId: request.id,
      amount,
      productName: program.title,
    });
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/clients");
    return { url, requestId: request.id };
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
      return { error: "Активная заявка не найдена — создайте ссылку заново" };
    }

    const programTitle =
      request.program && !Array.isArray(request.program) && typeof request.program === "object"
        ? (request.program as { title?: string }).title ?? "Программа"
        : "Программа";
    const amount = toFiniteNumber(request.amount);
    if (amount == null || amount <= 0) {
      return { error: "У заявки некорректная сумма — создайте ссылку заново" };
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
      return { error: "Ссылка только что была отправлена — подождите минуту" };
    }
    if (sendDedupError) {
      console.error("sendPaymentLinkToClient: dedup write failed:", sendDedupError.message);
    }

    const url = buildPaymentUrl({
      payformUrl,
      orderId: request.id,
      amount,
      productName: programTitle,
    });

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
    measurement_time?: string | null;
    measurement_day?: number | null;
    checkin_day?: number | null;
    checkin_time?: string | null;
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

    if (data.measurement_time !== undefined) {
      if (data.measurement_time !== null && data.measurement_time !== "") {
        if (!isQuarterTime(data.measurement_time)) {
          return {
            error:
              "Время напоминания замеров должно быть с шагом 15 минут (00, 15, 30, 45)",
          };
        }
        update.measurement_time = data.measurement_time;
      } else {
        update.measurement_time = null;
      }
    }

    if (data.measurement_day !== undefined) {
      if (data.measurement_day !== null) {
        if (
          !Number.isInteger(data.measurement_day) ||
          data.measurement_day < 1 ||
          data.measurement_day > 31
        ) {
          return { error: "День замеров должен быть числом от 1 до 31" };
        }
        update.measurement_day = data.measurement_day;
      } else {
        update.measurement_day = null;
      }
    }

    if (data.checkin_day !== undefined) {
      if (data.checkin_day !== null) {
        if (
          !Number.isInteger(data.checkin_day) ||
          data.checkin_day < 1 ||
          data.checkin_day > 7
        ) {
          return { error: "День чек-ина должен быть от 1 до 7" };
        }
        update.checkin_day = data.checkin_day;
      } else {
        update.checkin_day = null;
      }
    }

    if (data.checkin_time !== undefined) {
      if (data.checkin_time !== null && data.checkin_time !== "") {
        if (!isQuarterTime(data.checkin_time)) {
          return {
            error:
              "Время чек-ина должно быть с шагом 15 минут (00, 15, 30, 45)",
          };
        }
        update.checkin_time = data.checkin_time;
      } else {
        update.checkin_time = null;
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
        .eq("client_id", clientId);

      if (scheduleError) return { error: scheduleError.message };
    }

    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/clients");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}
