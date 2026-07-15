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
