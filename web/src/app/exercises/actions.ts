"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifySession } from "@/lib/dal";
import { normalizeExerciseName } from "@/lib/exercise-library";
import type { ExerciseFormData } from "./form-data";
import type { Database } from "@/types/supabase";

type ExerciseInsert = Database["public"]["Tables"]["exercises"]["Insert"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 120;
const MAX_TEXT_LENGTH = 4000;
const MAX_ARRAY_ITEMS = 30;
const MAX_ITEM_LENGTH = 200;
const MAX_VIDEO_URL_LENGTH = 500;
const VIDEO_URL_REGEX = /^https:\/\/\S+$/i;
const ALLOWED_DIFFICULTY = new Set(["", "beginner", "intermediate", "advanced"]);

function isRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

function validateAndBuild(data: ExerciseFormData): { payload?: ExerciseInsert; error?: string } {
  if (typeof data !== "object" || data === null || typeof data.name !== "string") {
    return { error: "Некорректные данные формы" };
  }
  if (
    !Array.isArray(data.aliases) ||
    !Array.isArray(data.featuresRu) ||
    !Array.isArray(data.featuresEn)
  ) {
    return { error: "Некорректные данные формы" };
  }
  for (const field of [
    "descriptionRu",
    "descriptionEn",
    "techniqueRu",
    "techniqueEn",
    "videoUrl",
    "muscleGroup",
    "equipment",
    "difficulty",
    "contraindications",
  ] as const) {
    if (typeof data[field] !== "string") {
      return { error: "Некорректные данные формы" };
    }
  }

  const name = data.name.trim();
  if (!name) return { error: "Название обязательно" };
  if (name.length > MAX_NAME_LENGTH) {
    return { error: `Название не должно превышать ${MAX_NAME_LENGTH} символов` };
  }

  const nameKey = normalizeExerciseName(name);
  if (!nameKey) return { error: "Название не содержит допустимых символов" };

  const difficulty = data.difficulty.trim();
  if (!ALLOWED_DIFFICULTY.has(difficulty)) {
    return { error: "Недопустимое значение сложности" };
  }

  const overMaxText = (
    value: string,
    label: string,
  ): { error?: string } => {
    const trimmed = value.trim();
    if (trimmed.length > MAX_TEXT_LENGTH) {
      return { error: `Поле «${label}» не должно превышать ${MAX_TEXT_LENGTH} символов` };
    }
    return {};
  };

  for (const [value, label] of [
    [data.descriptionRu, "Описание (RU)"],
    [data.descriptionEn, "Description (EN)"],
    [data.techniqueRu, "Техника (RU)"],
    [data.techniqueEn, "Technique (EN)"],
    [data.contraindications, "Противопоказания"],
    [data.muscleGroup, "Группа мышц"],
    [data.equipment, "Оборудование"],
  ] as const) {
    const result = overMaxText(value, label);
    if (result.error) return result;
  }

  const cleanArray = (values: string[], label: string): { result?: string[]; error?: string } => {
    if (values.length > MAX_ARRAY_ITEMS) {
      return { error: `«${label}»: не более ${MAX_ARRAY_ITEMS} пунктов` };
    }
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of values) {
      if (typeof raw !== "string") {
        return { error: "Некорректные данные формы" };
      }
      const value = raw.trim();
      if (!value || seen.has(value)) continue;
      if (value.length > MAX_ITEM_LENGTH) {
        return {
          error: `Элемент «${value.slice(0, 40)}…» в «${label}» длиннее ${MAX_ITEM_LENGTH} символов`,
        };
      }
      seen.add(value);
      result.push(value);
    }
    return { result };
  };

  const aliases = cleanArray(data.aliases, "Алиасы");
  if (aliases.error) return { error: aliases.error };
  const featuresRu = cleanArray(data.featuresRu, "Особенности (RU)");
  if (featuresRu.error) return { error: featuresRu.error };
  const featuresEn = cleanArray(data.featuresEn, "Features (EN)");
  if (featuresEn.error) return { error: featuresEn.error };

  const videoUrl = data.videoUrl.trim();
  if (videoUrl.length > MAX_VIDEO_URL_LENGTH) {
    return { error: `Ссылка на видео не должна превышать ${MAX_VIDEO_URL_LENGTH} символов` };
  }
  if (videoUrl && !VIDEO_URL_REGEX.test(videoUrl)) {
    return { error: "Ссылка на видео должна начинаться с https://" };
  }

  return {
    payload: {
      name,
      name_key: nameKey,
      aliases: aliases.result!,
      description_ru: data.descriptionRu.trim() || null,
      description_en: data.descriptionEn.trim() || null,
      technique_ru: data.techniqueRu.trim() || null,
      technique_en: data.techniqueEn.trim() || null,
      features_ru: featuresRu.result!,
      features_en: featuresEn.result!,
      video_url: videoUrl || null,
      muscle_group: data.muscleGroup.trim() || null,
      equipment: data.equipment.trim() || null,
      difficulty: difficulty || null,
      contraindications: data.contraindications.trim() || null,
    },
  };
}

function duplicateError(): { error: string } {
  return { error: "Упражнение с таким названием уже есть в библиотеке" };
}

function notFoundError(): { error: string } {
  return { error: "Упражнение не найдено" };
}

function handleCatch(e: unknown, context: string): { error: string } {
  if (isRedirectError(e)) throw e;
  console.error(`[EXERCISES:${context}]`, e);
  return { error: "Произошла ошибка" };
}

export async function createExercise(data: ExerciseFormData): Promise<{ error?: string; id?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }

    const { payload, error } = validateAndBuild(data);
    if (error || !payload) return { error };

    const { data: created, error: insertError } = await supabaseAdmin
      .from("exercises")
      .insert(payload)
      .select("id")
      .single();

    if (insertError) {
      if (insertError.code === "23505") return duplicateError();
      return { error: "Не удалось создать упражнение" };
    }

    revalidatePath("/exercises");
    return { id: created.id };
  } catch (e) {
    return handleCatch(e, "create");
  }
}

export async function updateExercise(
  id: string,
  data: ExerciseFormData,
): Promise<{ error?: string }> {
  try {
    if (!UUID_RE.test(id)) return { error: "Некорректный идентификатор" };

    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }

    const { payload, error } = validateAndBuild(data);
    if (error || !payload) return { error };

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("exercises")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (updateError) {
      if (updateError.code === "23505") return duplicateError();
      return { error: "Не удалось сохранить упражнение" };
    }
    if (!updated) return notFoundError();

    revalidatePath("/exercises");
    return {};
  } catch (e) {
    return handleCatch(e, "update");
  }
}

export async function deleteExercise(id: string): Promise<{ error?: string }> {
  try {
    if (!UUID_RE.test(id)) return { error: "Некорректный идентификатор" };

    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }

    const { data: deleted, error } = await supabaseAdmin
      .from("exercises")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) return { error: "Не удалось удалить упражнение" };
    if (!deleted) return notFoundError();

    revalidatePath("/exercises");
    return {};
  } catch (e) {
    return handleCatch(e, "delete");
  }
}