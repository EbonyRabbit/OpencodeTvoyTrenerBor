"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifySession } from "@/lib/dal";
import type { Database, PaymentStatus } from "@/types/supabase";
import { normalizeTelegramUsername, telegramDisplayName } from "@/lib/validation";

type ClientInsert = Database["public"]["Tables"]["clients"]["Insert"];

const TIMEZONE_REGEX = /^[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/;

export async function createClient(formData: {
  username?: string;
  language: string;
  timezone: string;
  payment_status: string;
  consent_given?: boolean;
}): Promise<{ error?: string; id?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }

    if (!formData.consent_given) {
      return { error: "Необходимо согласие клиента на обработку персональных данных" };
    }

    const rawUsername = (formData.username ?? "").trim();
    const normalizedUsername = rawUsername
      ? normalizeTelegramUsername(rawUsername)
      : null;
    if (rawUsername && !normalizedUsername) {
      return { error: "Укажите Telegram username (например, @username)." };
    }

    const language = formData.language === "en" ? "en" : "ru";
    const rawTimezone = formData.timezone.trim() || "UTC";
    const timezone = TIMEZONE_REGEX.test(rawTimezone) ? rawTimezone : "UTC";
    const payment_status: PaymentStatus =
      formData.payment_status === "paid" ? "paid" : "pending";

    const clientId = randomUUID();
    const name = normalizedUsername
      ? `@${normalizedUsername}`
      : telegramDisplayName(null, clientId);

    const insertData: ClientInsert = {
      id: clientId,
      name,
      language,
      timezone,
      payment_status,
      status: "inactive",
      telegram_id: null,
      program_id: null,
      connect_code: null,
      spreadsheet_id: null,
      morning_time: null,
      // measurement_time / measurement_day не передаём:
      // дефолты 08:00 и 1-е число проставляет БД (миграция Фазы 16)
      training_days: null,
      access_start_date: null,
      access_end_date: null,
      legacy_id: null,
      purchase_date: null,
      consent_given: true,
      consent_given_at: new Date().toISOString(),
      client_consent_given: false,
      client_consent_given_at: null,
      client_consent_ip: null,
      client_consent_user_agent: null,
      client_consent_version: null,
    };

    const { error } = await supabaseAdmin.from("clients").insert(insertData);

    if (error) {
      return { error: "Не удалось создать клиента" };
    }

    revalidatePath("/clients");
    return { id: clientId };
  } catch {
    return { error: "Произошла ошибка" };
  }
}
