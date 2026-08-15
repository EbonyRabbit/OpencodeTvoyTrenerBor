"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifySession } from "@/lib/dal";
import { generateSchedule } from "@/lib/plan-adjustment";
import type { Database, PaymentStatus } from "@/types/supabase";
import { TIMEZONE_LIST, LANGUAGE_LABELS, isQuarterTime } from "@/lib/clients";
import { sendTelegramMessage } from "@/lib/telegram";
import { buildProgramInstructions } from "@/lib/program-instructions";
import type { ActivityEvent } from "./activity-types";
import { ACTIVITY_PAGE_SIZE } from "./activity-types";

type RawWorkout = { id: string; created_at: string; exercise: string; sets: number | null; reps: string | null; weight: number | null };
type RawCheckin = { id: string; created_at: string; wellbeing: number | null; sleep: number | null; stress: number | null };
type RawMeasurement = { id: string; created_at: string; weight: number | null; waist: number | null; chest: number | null; hips: number | null };
// type RawPhoto = { id: string; created_at: string; type: string }; // DISABLED: photo storage removed
type RawMessage = { id: string; created_at: string; direction: string; text: string };
type RawNotification = { id: string; created_at: string; type: string; status: string };

const PER_TABLE_SIZE = 15;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fetchPage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientId: string,
  offset: number,
): Promise<ActivityEvent[]> {
  const from = offset;
  const to = offset + PER_TABLE_SIZE - 1;

  const [workouts, checkins, measurements, messages, notifications] = await Promise.all([
    supabase.from("workout_logs").select("id, created_at, exercise, sets, reps, weight").eq("client_id", clientId).order("created_at", { ascending: false }).range(from, to),
    supabase.from("checkins").select("id, created_at, wellbeing, sleep, stress").eq("client_id", clientId).order("created_at", { ascending: false }).range(from, to),
    supabase.from("measurements").select("id, created_at, weight, waist, chest, hips").eq("client_id", clientId).order("created_at", { ascending: false }).range(from, to),
    // supabase.from("photos").select("id, created_at, type").eq("client_id", clientId).order("created_at", { ascending: false }).range(from, to), // DISABLED: photo storage removed
    supabase.from("messages").select("id, created_at, direction, text").eq("client_id", clientId).order("created_at", { ascending: false }).range(from, to),
    supabase.from("notification_log").select("id, created_at, type, status").eq("client_id", clientId).order("created_at", { ascending: false }).range(from, to),
  ]);

  const all: ActivityEvent[] = [];

  for (const w of (workouts.data ?? []) as RawWorkout[]) {
    all.push({ id: w.id, date: w.created_at, event_type: "workout", details: { exercise: w.exercise, sets: w.sets, reps: w.reps, weight: w.weight } });
  }
  for (const c of (checkins.data ?? []) as RawCheckin[]) {
    all.push({ id: c.id, date: c.created_at, event_type: "checkin", details: { wellbeing: c.wellbeing, sleep: c.sleep, stress: c.stress } });
  }
  for (const m of (measurements.data ?? []) as RawMeasurement[]) {
    all.push({ id: m.id, date: m.created_at, event_type: "measurement", details: { weight: m.weight, waist: m.waist, chest: m.chest, hips: m.hips } });
  }
  // DISABLED: photo storage removed
  // for (const p of (photos.data ?? []) as RawPhoto[]) {
  //   all.push({ id: p.id, date: p.created_at, event_type: "photo", details: { type: p.type } });
  // }
  for (const msg of (messages.data ?? []) as RawMessage[]) {
    all.push({ id: msg.id, date: msg.created_at, event_type: "message", details: { direction: msg.direction, preview: msg.text } });
  }
  for (const n of (notifications.data ?? []) as RawNotification[]) {
    all.push({ id: n.id, date: n.created_at, event_type: "notification", details: { type: n.type, status: n.status } });
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

async function generateConnectCodeFor(clientId: string): Promise<string | null> {
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

async function resetPlanAssignments(clientId: string): Promise<{ error?: string }> {
  const { error: scheduleError } = await supabaseAdmin
    .from("program_schedule")
    .delete()
    .eq("client_id", clientId);
  if (scheduleError) {
    return { error: `Не удалось сбросить старое расписание: ${scheduleError.message}` };
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

type ProgramAssignment = {
  clientId: string;
  client: ClientForInstructions;
  programId: string;
  programTitle: string;
  accessEndDate: string;
  coachId: string;
};

async function assignProgramAndNotify(
  input: ProgramAssignment,
): Promise<{ error?: string; connectCode?: string; warning?: string; programAssigned?: boolean }> {
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

type ClientForInstructions = {
  name: string | null;
  language: string;
  telegram_id: number | null;
  connect_code: string | null;
  timezone: string | null;
};

async function notifyClientForProgram(
  clientId: string,
  client: ClientForInstructions,
  programTitle: string,
  accessEndDate: string | null,
  coachId: string,
): Promise<{ connectCode?: string; warning?: string }> {
  let connectCode: string | null = null;
  if (!client.telegram_id) {
    connectCode = resolveConnectCode(client) ?? (await generateConnectCodeFor(clientId));
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
  coachId: string;
};

async function deliverProgramInstructions(input: DeliverInstructionsInput): Promise<{
  warning?: string;
}> {
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
      ? { warning: "Инструкции доставлены в Telegram, но не сохранены в истории чата." }
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

export async function activateProgram(
  clientId: string,
  programId: string,
): Promise<{ error?: string; connectCode?: string; warning?: string; programAssigned?: boolean }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }
    if (!UUID_RE.test(clientId)) return { error: "Некорректный идентификатор" };

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id, name, telegram_id, language, connect_code, payment_status, program_id, timezone")
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
    if (program.duration_weeks <= 0) return { error: "Некорректная длительность программы" };

    const now = new Date();
    const endDate = new Date(now.getTime() + program.duration_weeks * 7 * 24 * 60 * 60 * 1000);

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
      .select("id, name, telegram_id, language, connect_code, program_id, access_end_date, payment_status, timezone")
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

    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

    for (let i = 0; i < 5; i++) {
      const token = generateToken(TOKEN_LENGTH);
      const { error } = await supabaseAdmin
        .from("client_tokens")
        .insert({ client_id: clientId, token, expires_at: expiresAt, last_used_at: null });
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

    const nextStatus: PaymentStatus = currentStatus === "paid" ? "pending" : "paid";

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
): Promise<{ error?: string; connectCode?: string; warning?: string; programAssigned?: boolean }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }
    if (!UUID_RE.test(clientId)) return { error: "Некорректный идентификатор" };

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id, name, telegram_id, language, connect_code, program_id, timezone")
      .eq("id", clientId)
      .maybeSingle();
    if (!client) return { error: "Клиент не найден" };

    const { data: program } = await supabaseAdmin
      .from("programs")
      .select("id, title, duration_weeks")
      .eq("id", programId)
      .maybeSingle();
    if (!program) return { error: "Программа не найдена" };
    if (program.duration_weeks <= 0) return { error: "Некорректная длительность программы" };

    const now = new Date();
    const endDate = new Date(now.getTime() + program.duration_weeks * 7 * 24 * 60 * 60 * 1000);

    const { error: updateError } = await supabaseAdmin
      .from("clients")
      .update({
        purchased_program_id: programId,
        program_id: programId,
        payment_status: "paid",
        purchase_date: now.toISOString(),
        status: "active",
        access_start_date: now.toISOString(),
        access_end_date: endDate.toISOString(),
      })
      .eq("id", clientId);
    if (updateError) return { error: updateError.message };

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
          return { error: "Время утреннего напоминания должно быть с шагом 15 минут (00, 15, 30, 45)" };
        }
        update.morning_time = data.morning_time;
      } else {
        update.morning_time = null;
      }
    }

    if (data.measurement_time !== undefined) {
      if (data.measurement_time !== null && data.measurement_time !== "") {
        if (!isQuarterTime(data.measurement_time)) {
          return { error: "Время напоминания замеров должно быть с шагом 15 минут (00, 15, 30, 45)" };
        }
        update.measurement_time = data.measurement_time;
      } else {
        update.measurement_time = null;
      }
    }

    if (data.measurement_day !== undefined) {
      if (data.measurement_day !== null) {
        if (!Number.isInteger(data.measurement_day) || data.measurement_day < 1 || data.measurement_day > 31) {
          return { error: "День замеров должен быть числом от 1 до 31" };
        }
        update.measurement_day = data.measurement_day;
      } else {
        update.measurement_day = null;
      }
    }

    if (data.checkin_day !== undefined) {
      if (data.checkin_day !== null) {
        if (!Number.isInteger(data.checkin_day) || data.checkin_day < 1 || data.checkin_day > 7) {
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
          return { error: "Время чек-ина должно быть с шагом 15 минут (00, 15, 30, 45)" };
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
