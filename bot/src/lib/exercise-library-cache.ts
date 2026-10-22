import { supabaseAdmin } from "./supabase-admin.js";
import type { ExerciseLibraryRow } from "./exercise-library.js";

// Общий кэш библиотеки для кнопки «Техника и видео» и подбора замен.
// muscle_group/equipment нужны заменам, контентные поля - карточке техники.
export const LIBRARY_SELECT =
  "id, name, name_key, aliases, muscle_group, equipment, description_ru, description_en, " +
  "technique_ru, technique_en, features_ru, features_en, video_url";

const LIBRARY_CACHE_TTL_MS = 5 * 60 * 1000;
// PostgREST по умолчанию отдаёт не больше 1000 строк; предупреждаем, если упёрлись.
const LIBRARY_ROW_LIMIT = 1000;

let cache: { rows: ExerciseLibraryRow[]; fetchedAt: number } | null = null;
let inFlight: Promise<ExerciseLibraryRow[]> | null = null;

export function clearExerciseLibraryCache(): void {
  cache = null;
  inFlight = null;
}

export async function loadExerciseLibraryRows(): Promise<ExerciseLibraryRow[]> {
  if (inFlight) return inFlight;
  const now = Date.now();
  if (cache && now - cache.fetchedAt < LIBRARY_CACHE_TTL_MS) {
    return cache.rows;
  }

  const task = supabaseAdmin
    .from("exercises")
    .select(LIBRARY_SELECT)
    .then(({ data, error }): ExerciseLibraryRow[] => {
      if (error) {
        console.error(`[EXERCISE_LIBRARY] Library query error:`, error.message);
        // Транзитная ошибка БД - отдаём прошлый снимок вместо «не найдено».
        return cache?.rows ?? [];
      }
      const rows = (data ?? []) as unknown as ExerciseLibraryRow[];
      if (rows.length >= LIBRARY_ROW_LIMIT) {
        console.warn(
          `[EXERCISE_LIBRARY] Library has ${rows.length} rows (limit ${LIBRARY_ROW_LIMIT}); ` +
            "часть записей может не попасть в кэш - нужна пагинация.",
        );
      }
      cache = { rows, fetchedAt: Date.now() };
      return rows;
    });

  let pending: Promise<ExerciseLibraryRow[]>;
  pending = Promise.resolve(task)
    .catch(() => {
      // Транспортный reject (сеть, таймаут) - stale-снимок вместо пустоты.
      console.error(`[EXERCISE_LIBRARY] Library fetch rejected`);
      return cache?.rows ?? [];
    })
    .finally(() => {
      // Не затираем новый in-flight, если кэш очистили во время запроса.
      if (inFlight === pending) inFlight = null;
    });
  inFlight = pending;
  return pending;
}
