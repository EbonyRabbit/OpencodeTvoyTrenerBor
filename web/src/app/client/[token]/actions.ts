"use server";

import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";

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

type MeasurementInput = {
  weight: number | null;
  chest: number | null;
  waist: number | null;
  hips: number | null;
  left_arm: number | null;
  right_arm: number | null;
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

    const { error } = await supabaseAdmin.from("measurements").insert({
      client_id: clientId,
      date,
      weight: data.weight,
      chest: data.chest,
      waist: data.waist,
      hips: data.hips,
      left_arm: data.left_arm,
      right_arm: data.right_arm,
      comment: data.comment,
      abdomen: null,
      glutes: null,
      left_thigh: null,
      right_thigh: null,
      body_fat: null,
      muscle_mass: null,
      visceral_fat: null,
    });
    if (error) return { error: error.message };

    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}
