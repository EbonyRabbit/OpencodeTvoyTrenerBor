"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifySession } from "@/lib/dal";
import type { Database, PaymentStatus } from "@/types/supabase";

type ClientInsert = Database["public"]["Tables"]["clients"]["Insert"];

const TIMEZONE_REGEX = /^[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/;
const MAX_NAME_LENGTH = 100;

export async function createClient(formData: {
  name: string;
  telegram_id?: number | null;
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

    const name = formData.name.trim();
    if (!name) return { error: "Имя обязательно" };
    if (name.length > MAX_NAME_LENGTH) {
      return { error: `Имя не должно превышать ${MAX_NAME_LENGTH} символов` };
    }

    if (!formData.consent_given) {
      return { error: "Необходимо согласие клиента на обработку персональных данных" };
    }

    const language = formData.language === "en" ? "en" : "ru";
    const rawTimezone = formData.timezone.trim() || "UTC";
    const timezone = TIMEZONE_REGEX.test(rawTimezone) ? rawTimezone : "UTC";
    const payment_status: PaymentStatus =
      formData.payment_status === "paid" ? "paid" : "pending";

    const insertData: ClientInsert = {
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
      measurement_time: null,
      measurement_day: null,
      training_days: null,
      access_start_date: null,
      access_end_date: null,
      legacy_id: null,
      purchase_date: null,
      purchased_program_id: null,
      consent_given: true,
      consent_given_at: new Date().toISOString(),
      client_consent_given: true,
      client_consent_given_at: null,
      client_consent_ip: null,
      client_consent_user_agent: null,
      client_consent_version: null,
    };

    if (formData.telegram_id && formData.telegram_id > 0) {
      insertData.telegram_id = Math.floor(formData.telegram_id);
    }

    const { data, error } = await supabaseAdmin
      .from("clients")
      .insert(insertData)
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        return { error: "Клиент с таким Telegram ID уже существует" };
      }
      return { error: "Не удалось создать клиента" };
    }

    revalidatePath("/clients");
    return { id: data.id };
  } catch {
    return { error: "Произошла ошибка" };
  }
}
