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
