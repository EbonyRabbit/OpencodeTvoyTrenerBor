"use server";

import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getActiveProgramPeriod } from "@/lib/program-periods";
import { TIMEZONE_LIST, LANGUAGE_LABELS, isQuarterTime } from "@/lib/clients";
import { PRIVACY_POLICY_VERSION } from "@/lib/consent";

type ExerciseLog = {
  type: "strength" | "cardio" | "circuit";
  exercise: string;
  sets: number | null;
  reps: string | null;
  weight: number | null;
  rpe: number | null;
  rounds: number | null;
  distance_km: number | null;
  duration_sec: number | null;
  heart_rate: number | null;
  pace: string | null;
  comment: string | null;
};

function isNumberInRange(value: number | null, min: number, max: number, integer = false): boolean {
  return value === null || (
    Number.isFinite(value) &&
    value >= min &&
    value <= max &&
    (!integer || Number.isInteger(value))
  );
}

function validateExerciseLog(ex: ExerciseLog): string | null {
  if (ex.type !== "strength" && ex.type !== "cardio" && ex.type !== "circuit") {
    return "Некорректный тип упражнения";
  }
  if (!ex.exercise?.trim() || ex.exercise.length > 300) return "Некорректное название упражнения";
  if (ex.reps !== null && ex.reps.length > 500) return `${ex.exercise}: слишком длинное значение повторов`;
  if (ex.pace !== null) {
    const timePace = ex.pace.match(/^(\d{1,3}):(\d{2})$/);
    const numericPace = Number(ex.pace);
    const validTimePace = timePace !== null && Number(timePace[1]) <= 599 && Number(timePace[2]) <= 59;
    const validNumericPace = !timePace && Number.isFinite(numericPace) && numericPace > 0 && numericPace <= 30;
    if (ex.pace.length > 20 || (!validTimePace && !validNumericPace)) {
      return `${ex.exercise}: некорректный темп`;
    }
  }
  if (ex.comment !== null && ex.comment.length > 2000) return `${ex.exercise}: комментарий слишком длинный`;
  if (!isNumberInRange(ex.sets, 0, 100, true)) return `${ex.exercise}: некорректное число подходов`;
  if (!isNumberInRange(ex.weight, 0, 1000)) return `${ex.exercise}: некорректный вес`;
  if (!isNumberInRange(ex.rpe, 1, 10, true)) return `${ex.exercise}: RPE должен быть от 1 до 10`;
  if (!isNumberInRange(ex.rounds, -1, 99, true)) return `${ex.exercise}: некорректное число раундов`;
  if (!isNumberInRange(ex.distance_km, 0.001, 500)) return `${ex.exercise}: некорректная дистанция`;
  if (!isNumberInRange(ex.duration_sec, 1, 86400, true)) return `${ex.exercise}: некорректное время`;
  if (!isNumberInRange(ex.heart_rate, 30, 250, true)) return `${ex.exercise}: некорректный пульс`;

  if (ex.type === "cardio" && (
    ex.distance_km === null || ex.duration_sec === null || ex.heart_rate === null || ex.pace === null
  )) return `${ex.exercise}: заполните дистанцию, время, темп и пульс`;
  if (ex.type === "circuit" && ex.rounds === null) {
    return `${ex.exercise}: укажите число раундов или МАКС`;
  }
  if (ex.type === "circuit" && ex.duration_sec !== null) {
    return `${ex.exercise}: время для круговой не указывается`;
  }
  return null;
}

export async function logWorkoutFromWeb(
  date: string,
  week: number | null,
  dayOrder: number | null,
  exercises: ExerciseLog[],
): Promise<{ error?: string }> {
  try {
    const h = await headers();
    const clientId = h.get("x-client-id");
    if (!clientId) return { error: "Не авторизован" };

    if (!exercises || exercises.length === 0) {
      return { error: "Нет упражнений для сохранения" };
    }
    if (exercises.length > 100 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { error: "Некорректные данные тренировки" };
    }
    if (week !== null && (!Number.isInteger(week) || week < 0 || week > 1000)) {
      return { error: "Некорректный номер недели" };
    }
    if (dayOrder !== null && (!Number.isInteger(dayOrder) || dayOrder < 1 || dayOrder > 7)) {
      return { error: "Некорректный тренировочный день" };
    }
    for (const exercise of exercises) {
      const validationError = validateExerciseLog(exercise);
      if (validationError) return { error: validationError };
    }

    const period = await getActiveProgramPeriod(clientId);

    const rows = exercises.map((ex) => ({
      client_id: clientId,
      program_id: period?.program_id ?? null,
      program_period_id: period?.id ?? null,
      date,
      week,
      day_order: dayOrder,
      exercise: ex.exercise,
      sets: ex.sets,
      reps: ex.reps,
      weight: ex.weight,
      rpe: ex.rpe,
      rounds: ex.rounds,
      distance_km: ex.distance_km,
      duration_sec: ex.duration_sec,
      heart_rate: ex.heart_rate,
      pace: ex.pace,
      comment: ex.comment,
    }));

    const { error } = await supabaseAdmin.from("workout_logs").insert(rows);
    if (error) {
      console.error(`[WORKOUT_WEB] Insert failed for ${clientId}:`, error.message);
      return { error: "Не удалось сохранить тренировку" };
    }

    return {};
  } catch (error) {
    console.error("[WORKOUT_WEB] Unexpected insert error:", error);
    return { error: "Произошла ошибка" };
  }
}

export type ClientSettingsInput = {
  language: string;
  timezone: string | null;
  morning_time: string | null;
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
      if (!isQuarterTime(data.morning_time)) {
        return { error: "Время утреннего напоминания должно быть с шагом 15 минут (00, 15, 30, 45)" };
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
        training_days: data.training_days ?? null,
      })
      .eq("id", clientId);

    if (error) return { error: error.message };

    const { error: scheduleError } = await supabaseAdmin
      .from("program_schedule")
      .update({ training_days: data.training_days ?? null })
      .eq("client_id", clientId)
      .neq("status", "archived");

    if (scheduleError) return { error: scheduleError.message };

    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

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
