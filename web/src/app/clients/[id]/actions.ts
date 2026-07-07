"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifySession } from "@/lib/dal";
import { generateSchedule } from "@/lib/plan-adjustment";
import type { Database, PaymentStatus } from "@/types/supabase";
import type { ActivityEvent } from "./activity-types";
import { ACTIVITY_PAGE_SIZE } from "./activity-types";

type RawWorkout = { id: string; created_at: string; exercise: string; sets: number | null; reps: string | null; weight: number | null };
type RawCheckin = { id: string; created_at: string; wellbeing: number | null; sleep: number | null; stress: number | null };
type RawMeasurement = { id: string; created_at: string; weight: number | null; waist: number | null; chest: number | null; hips: number | null };
type RawPhoto = { id: string; created_at: string; type: string };
type RawMessage = { id: string; created_at: string; direction: string; text: string };
type RawNotification = { id: string; created_at: string; type: string; status: string };

const PER_TABLE_SIZE = 15;

async function fetchPage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientId: string,
  offset: number,
): Promise<ActivityEvent[]> {
  const from = offset;
  const to = offset + PER_TABLE_SIZE - 1;

  const [workouts, checkins, measurements, photos, messages, notifications] = await Promise.all([
    supabase.from("workout_logs").select("id, created_at, exercise, sets, reps, weight").eq("client_id", clientId).order("created_at", { ascending: false }).range(from, to),
    supabase.from("checkins").select("id, created_at, wellbeing, sleep, stress").eq("client_id", clientId).order("created_at", { ascending: false }).range(from, to),
    supabase.from("measurements").select("id, created_at, weight, waist, chest, hips").eq("client_id", clientId).order("created_at", { ascending: false }).range(from, to),
    supabase.from("photos").select("id, created_at, type").eq("client_id", clientId).order("created_at", { ascending: false }).range(from, to),
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
  for (const p of (photos.data ?? []) as RawPhoto[]) {
    all.push({ id: p.id, date: p.created_at, event_type: "photo", details: { type: p.type } });
  }
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
    .select("id, title, active")
    .eq("active", true)
    .order("title");
  return data ?? [];
}

export async function activateProgram(
  clientId: string,
  programId: string,
): Promise<{ error?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }

    const { data: program } = await supabaseAdmin
      .from("programs")
      .select("id")
      .eq("id", programId)
      .maybeSingle();
    if (!program) return { error: "Программа не найдена" };

    const { error } = await supabaseAdmin
      .from("clients")
      .update({ program_id: programId, status: "active" })
      .eq("id", clientId);
    if (error) return { error: error.message };

    const scheduleError = await generateSchedule(clientId, programId);
    if (scheduleError.error) {
      return { error: `Программа назначена, но не удалось создать расписание: ${scheduleError.error}` };
    }

    revalidatePath(`/clients/${clientId}`);
    return {};
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

    for (let i = 0; i < 5; i++) {
      const code = crypto.randomUUID().slice(0, 8).toUpperCase();
      const { error } = await supabaseAdmin
        .from("clients")
        .update({ connect_code: code })
        .eq("id", clientId);
      if (!error) {
        revalidatePath(`/clients/${clientId}`);
        return { code };
      }
      if (error.code !== "23505") return { error: error.message };
    }

    return { error: "Не удалось сгенерировать уникальный код" };
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
      .update({ status: "inactive", program_id: null })
      .eq("id", clientId);
    if (error) return { error: error.message };

    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/clients");
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
): Promise<{ error?: string; connectCode?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("program_id, telegram_id, name")
      .eq("id", clientId)
      .maybeSingle();
    if (!client) return { error: "Клиент не найден" };
    if (client.program_id) {
      return { error: "У клиента уже есть активная программа. Сначала отключите текущую." };
    }

    const { data: program } = await supabaseAdmin
      .from("programs")
      .select("id, duration_weeks, title")
      .eq("id", programId)
      .maybeSingle();
    if (!program) return { error: "Программа не найдена" };
    if (program.duration_weeks <= 0) return { error: "Некорректная длительность программы" };

    const now = new Date();
    const endDate = new Date(now.getTime() + program.duration_weeks * 7 * 24 * 60 * 60 * 1000);

    const { error: updateError } = await supabaseAdmin
      .from("clients")
      .update({
        program_id: programId,
        purchased_program_id: programId,
        status: "active",
        payment_status: "paid",
        purchase_date: now.toISOString(),
        access_start_date: now.toISOString(),
        access_end_date: endDate.toISOString(),
      })
      .eq("id", clientId);
    if (updateError) return { error: updateError.message };

    let connectCode: string | undefined;
    if (!client.telegram_id) {
      for (let i = 0; i < 5; i++) {
        const code = crypto.randomUUID().slice(0, 8).toUpperCase();
        const { error: codeError } = await supabaseAdmin
          .from("clients")
          .update({ connect_code: code })
          .eq("id", clientId);
        if (!codeError) {
          connectCode = code;
          break;
        }
        if (codeError.code !== "23505") break;
      }
    }

    const scheduleError = await generateSchedule(clientId, programId);
    if (scheduleError.error) {
      revalidatePath(`/clients/${clientId}`);
      return { error: `Программа назначена, но не удалось создать расписание: ${scheduleError.error}` };
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (BOT_TOKEN && client.telegram_id) {
      const text = `Покупка подтверждена!\n\nПрограмма: ${program.title}\nДоступ до: ${endDate.toLocaleDateString("ru-RU")}\n\nНапишите /menu для начала тренировок.`;
      try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: client.telegram_id, text }),
        });
      } catch {
        // Telegram notification is best-effort
      }
    }

    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/clients");
    return { connectCode };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}
