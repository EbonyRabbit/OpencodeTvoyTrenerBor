"use server";

import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getTodayDateStr } from "@/lib/date-utils";
import { TIMEZONE_LIST, LANGUAGE_LABELS } from "@/lib/clients";
// import { type PhotoType } from "@/types/supabase"; // DISABLED: photo storage removed

type ExerciseLog = {
  exercise: string;
  sets: number | null;
  reps: string | null;
  weight: number | null;
  rpe: number | null;
  comment: string | null;
};

export async function logWorkoutFromWeb(
  date: string,
  week: number | null,
  exercises: ExerciseLog[],
): Promise<{ error?: string }> {
  try {
    const h = await headers();
    const clientId = h.get("x-client-id");
    if (!clientId) return { error: "Не авторизован" };

    if (!exercises || exercises.length === 0) {
      return { error: "Нет упражнений для сохранения" };
    }

    const rows = exercises.map((ex) => ({
      client_id: clientId,
      date,
      week,
      exercise: ex.exercise,
      sets: ex.sets,
      reps: ex.reps,
      weight: ex.weight,
      rpe: ex.rpe,
      comment: ex.comment,
    }));

    const { error } = await supabaseAdmin.from("workout_logs").insert(rows);
    if (error) return { error: error.message };

    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

export type MeasurementInput = {
  weight: number | null;
  waist: number | null;
  abdomen: number | null;
  chest: number | null;
  hips: number | null;
  glutes: number | null;
  left_thigh: number | null;
  right_thigh: number | null;
  left_arm: number | null;
  right_arm: number | null;
  body_fat: number | null;
  muscle_mass: number | null;
  visceral_fat: number | null;
  comment: string | null;
};

export async function saveMeasurements(
  date: string,
  data: MeasurementInput,
): Promise<{ error?: string }> {
  try {
    const h = await headers();
    const clientId = h.get("x-client-id");
    if (!clientId) return { error: "Не авторизован" };

    const { error } = await supabaseAdmin.from("measurements").upsert(
      {
        client_id: clientId,
        date,
        weight: data.weight,
        waist: data.waist,
        abdomen: data.abdomen,
        chest: data.chest,
        hips: data.hips,
        glutes: data.glutes,
        left_thigh: data.left_thigh,
        right_thigh: data.right_thigh,
        left_arm: data.left_arm,
        right_arm: data.right_arm,
        body_fat: data.body_fat,
        muscle_mass: data.muscle_mass,
        visceral_fat: data.visceral_fat,
        comment: data.comment,
      },
      { onConflict: "client_id,date" },
    );
    if (error) return { error: error.message };

    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

// DISABLED: photo storage removed — clients save photos on their own devices
// const PHOTO_STORAGE_BUCKET = "client-photos";
// const MAX_FILE_SIZE = 10 * 1024 * 1024;
// const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
// const VALID_PHOTO_TYPES: PhotoType[] = ["front", "side", "back"];
//
// const EXT_BY_MIME: Record<string, string> = {
//   "image/jpeg": "jpg",
//   "image/png": "png",
//   "image/webp": "webp",
// };
//
// export async function uploadPhoto(
//   photoType: PhotoType,
//   formData: FormData,
// ): Promise<{ error?: string; storagePath?: string }> {
//   try {
//     const h = await headers();
//     const clientId = h.get("x-client-id");
//     if (!clientId) return { error: "Не авторизован" };
//
//     if (!VALID_PHOTO_TYPES.includes(photoType)) {
//       return { error: "Неверный тип фото" };
//     }
//
//     const file = formData.get("file") as File | null;
//     if (!file || file.size === 0) {
//       return { error: "Файл не выбран" };
//     }
//
//     if (!ALLOWED_TYPES.includes(file.type as (typeof ALLOWED_TYPES)[number])) {
//       return { error: "Допустимые форматы: JPEG, PNG, WebP" };
//     }
//
//     if (file.size > MAX_FILE_SIZE) {
//       return { error: "Максимальный размер файла — 10 МБ" };
//     }
//
//     const { data: client } = await supabaseAdmin
//       .from("clients")
//       .select("id, program_id, timezone")
//       .eq("id", clientId)
//       .maybeSingle<{ id: string; program_id: string | null; timezone: string | null }>();
//
//     if (!client) return { error: "Клиент не найден" };
//
//     const tz = client.timezone || "Europe/Moscow";
//     const today = getTodayDateStr(tz);
//
//     let weekNumber: number | null = null;
//     if (client.program_id) {
//       const { data: schedule } = await supabaseAdmin
//         .from("program_schedule")
//         .select("week_number, start_date, end_date")
//         .eq("client_id", clientId)
//         .order("week_number", { ascending: true });
//
//       for (const week of schedule ?? []) {
//         if (!week.start_date || !week.end_date) continue;
//         if (today >= week.start_date && today <= week.end_date) {
//           weekNumber = week.week_number;
//           break;
//         }
//       }
//     }
//
//     const ext = EXT_BY_MIME[file.type] ?? "jpg";
//     const weekPart = weekNumber != null ? `week${weekNumber}` : "noweek";
//     const storagePath = `clients/${clientId}/${weekPart}_${today}/${photoType}.${ext}`;
//
//     const buffer = Buffer.from(await file.arrayBuffer());
//
//     const { error: uploadError } = await supabaseAdmin.storage
//       .from(PHOTO_STORAGE_BUCKET)
//       .upload(storagePath, buffer, {
//         contentType: file.type,
//         upsert: true,
//       });
//
//     if (uploadError) return { error: uploadError.message };
//
//     const { error: dbError } = await supabaseAdmin.from("photos").upsert(
//       {
//         client_id: clientId,
//         date: today,
//         week: weekNumber,
//         type: photoType,
//         storage_path: storagePath,
//         drive_url: null,
//         folder_url: null,
//       },
//       { onConflict: "client_id,date,type" },
//     );
//
//     if (dbError) return { error: dbError.message };
//
//     return { storagePath };
//   } catch (e) {
//     return { error: e instanceof Error ? e.message : "Произошла ошибка" };
//   }
// }

export type CheckinInput = {
  wellbeing: number;
  sleep: number;
  stress: number;
  nutrition_adherence: number;
  missed_workouts: number;
  complaints: string | null;
  comment: string | null;
};

const MAX_TEXT_LENGTH = 2000;

export async function saveCheckin(
  data: CheckinInput,
): Promise<{ error?: string }> {
  try {
    const h = await headers();
    const clientId = h.get("x-client-id");
    if (!clientId) return { error: "Не авторизован" };

    const wellbeing = Number(data.wellbeing);
    const sleep = Number(data.sleep);
    const stress = Number(data.stress);
    const nutrition_adherence = Number(data.nutrition_adherence);
    const missed_workouts = Number(data.missed_workouts);

    if (!Number.isFinite(wellbeing) || wellbeing < 1 || wellbeing > 10) {
      return { error: "Самочувствие должно быть от 1 до 10" };
    }
    if (!Number.isFinite(sleep) || sleep < 0 || sleep > 24) {
      return { error: "Часы сна должны быть от 0 до 24" };
    }
    if (!Number.isFinite(stress) || stress < 1 || stress > 10) {
      return { error: "Стресс должен быть от 1 до 10" };
    }
    if (!Number.isFinite(nutrition_adherence) || nutrition_adherence < 0 || nutrition_adherence > 100) {
      return { error: "Придержание питания должно быть от 0 до 100" };
    }
    if (!Number.isFinite(missed_workouts) || !Number.isInteger(missed_workouts) || missed_workouts < 0 || missed_workouts > 30) {
      return { error: "Пропущенные тренировки: целое число от 0 до 30" };
    }

    const complaints = data.complaints?.trim().slice(0, MAX_TEXT_LENGTH) || null;
    const comment = data.comment?.trim().slice(0, MAX_TEXT_LENGTH) || null;

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id, program_id, timezone")
      .eq("id", clientId)
      .maybeSingle<{ id: string; program_id: string | null; timezone: string | null }>();

    if (!client) return { error: "Клиент не найден" };

    const tz = client.timezone || "Europe/Moscow";
    const today = getTodayDateStr(tz);

    let weekNumber: number | null = null;
    if (client.program_id) {
      const { data: schedule } = await supabaseAdmin
        .from("program_schedule")
        .select("week_number, start_date, end_date")
        .eq("client_id", clientId)
        .order("week_number", { ascending: true });

      for (const week of schedule ?? []) {
        if (!week.start_date || !week.end_date) continue;
        if (today >= week.start_date && today <= week.end_date) {
          weekNumber = week.week_number;
          break;
        }
      }
    }

    const { error } = await supabaseAdmin.from("checkins").insert({
      client_id: clientId,
      date: today,
      week: weekNumber,
      wellbeing,
      sleep,
      stress,
      nutrition_adherence,
      missed_workouts,
      complaints,
      comment,
    });

    if (error) return { error: "Не удалось сохранить чек-ин" };

    return {};
  } catch {
    return { error: "Произошла ошибка" };
  }
}

export type ClientSettingsInput = {
  language: string;
  timezone: string | null;
  morning_time: string | null;
  measurement_time: string | null;
  measurement_day: number | null;
  training_days: number[] | null;
};

export async function updateClientSettings(
  data: ClientSettingsInput,
): Promise<{ error?: string }> {
  try {
    const h = await headers();
    const clientId = h.get("x-client-id");
    if (!clientId) return { error: "Не авторизован" };

    if (!(data.language in LANGUAGE_LABELS)) {
      return { error: "Некорректный язык" };
    }

    if (data.timezone !== null && data.timezone !== "") {
      if (!TIMEZONE_LIST.includes(data.timezone as typeof TIMEZONE_LIST[number])) {
        return { error: "Некорректный часовой пояс" };
      }
    }

    if (data.morning_time !== null && data.morning_time !== "") {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.morning_time)) {
        return { error: "Некорректное время утреннего напоминания" };
      }
    }

    if (data.measurement_time !== null && data.measurement_time !== "") {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.measurement_time)) {
        return { error: "Некорректное время напоминания замеров" };
      }
    }

    if (data.measurement_day !== null) {
      if (!Number.isInteger(data.measurement_day) || data.measurement_day < 1 || data.measurement_day > 7) {
        return { error: "День замеров должен быть от 1 до 7" };
      }
    }

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
    }

    const { error } = await supabaseAdmin
      .from("clients")
      .update({
        language: data.language,
        timezone: data.timezone || null,
        morning_time: data.morning_time || null,
        measurement_time: data.measurement_time || null,
        measurement_day: data.measurement_day ?? null,
        training_days: data.training_days ?? null,
      })
      .eq("id", clientId);

    if (error) return { error: error.message };

    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

const PRIVACY_POLICY_VERSION = "2026-07-16";

export async function acceptConsent(): Promise<{ error?: string }> {
  try {
    const h = await headers();
    const clientId = h.get("x-client-id");
    if (!clientId) return { error: "Не авторизован" };

    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const userAgent = h.get("user-agent") ?? null;

    const { error } = await supabaseAdmin
      .from("clients")
      .update({
        client_consent_given: true,
        client_consent_given_at: new Date().toISOString(),
        client_consent_ip: ip,
        client_consent_user_agent: userAgent,
        client_consent_version: PRIVACY_POLICY_VERSION,
      })
      .eq("id", clientId);

    if (error) return { error: error.message };

    return {};
  } catch {
    return { error: "Произошла ошибка" };
  }
}
