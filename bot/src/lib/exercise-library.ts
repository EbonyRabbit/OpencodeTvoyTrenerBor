import { flattenLoggableExercises, type ParsedExercise } from "./program-utils.js";

// ⚠️ MUST stay in sync with web/src/lib/exercise-library.ts
// Единственный источник истины для normalize: эта функция. SQL-бэкфилл в
// supabase/migrations/20260815000000_exercise_library.sql — упрощённый аналог
// (lower + strip [^a-z0-9а-я] + ё→е); для реальных названий результаты совпадают.
// При изменении normalize — правь ВСЕ копии: web/src/lib/exercise-library.ts,
// bot/src/lib/exercise-library.ts и SQL в миграции.

export interface ExerciseLibraryRow {
  id: string;
  name: string;
  name_key: string;
  aliases: string[];
  description_ru: string | null;
  description_en: string | null;
  technique_ru: string | null;
  technique_en: string | null;
  features_ru: string[];
  features_en: string[];
  video_url: string | null;
}

export type LibraryLanguage = "ru" | "en";

export interface ExerciseLibraryEntry {
  id: string;
  name: string;
  nameKey: string;
  techniqueRu: string | null;
  techniqueEn: string | null;
  featuresRu: string[];
  featuresEn: string[];
  videoUrl: string | null;
}

export function normalizeExerciseName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .trim();
}

export function buildExerciseLibraryMap(rows: ExerciseLibraryRow[]): Map<string, ExerciseLibraryEntry> {
  // Двухфазная сборка: сначала все канонические name_key, затем алиасы.
  // Каноническое имя всегда побеждает алиас другой записи: если в сиде или
  // через CRUD алиас одной записи совпадает с каноническим именем другой,
  // бот показывает технику именно той записи, на которую ссылается программа.
  const map = new Map<string, ExerciseLibraryEntry>();
  const aliasPairs: [string, ExerciseLibraryEntry][] = [];
  for (const row of rows) {
    const key = normalizeExerciseName(row.name_key);
    if (!key || map.has(key)) continue;
    const entry: ExerciseLibraryEntry = {
      id: row.id,
      name: row.name,
      nameKey: row.name_key,
      techniqueRu: row.technique_ru ?? null,
      techniqueEn: row.technique_en ?? null,
      featuresRu: row.features_ru ?? [],
      featuresEn: row.features_en ?? [],
      videoUrl: row.video_url ?? null,
    };
    map.set(key, entry);
    for (const alias of row.aliases ?? []) {
      const aliasKey = normalizeExerciseName(alias);
      if (aliasKey) aliasPairs.push([aliasKey, entry]);
    }
  }
  for (const [aliasKey, entry] of aliasPairs) {
    if (!map.has(aliasKey)) map.set(aliasKey, entry);
  }
  return map;
}

export function findLibraryEntry(
  map: Map<string, ExerciseLibraryEntry>,
  programName: string,
): ExerciseLibraryEntry | undefined {
  return map.get(normalizeExerciseName(programName));
}

export function collectLibraryKeys(exercises: ParsedExercise[]): string[] {
  const keys: string[] = [];
  for (const leaf of flattenLoggableExercises(exercises)) {
    const key = normalizeExerciseName(leaf.name);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

const INFO_LABELS: Record<LibraryLanguage, { technique: string; features: string }> = {
  ru: {
    technique: "Техника",
    features: "Особенности",
  },
  en: {
    technique: "Technique",
    features: "Features",
  },
};

export function formatExerciseInfo(
  entry: ExerciseLibraryEntry,
  lang: LibraryLanguage,
): { text: string; videoUrl: string | null } {
  const labels = INFO_LABELS[lang];
  const technique = lang === "en"
    ? (entry.techniqueEn ?? entry.techniqueRu)
    : (entry.techniqueRu ?? entry.techniqueEn);
  const featuresSource =
    (lang === "en" ? entry.featuresEn : entry.featuresRu) ?? [];
  const features =
    featuresSource.length > 0
      ? featuresSource
      : (lang === "en" ? entry.featuresRu : entry.featuresEn) ?? [];

  const parts: string[] = [];
  parts.push(`${labels.technique}:\n${technique || "—"}`);
  if (features.length > 0) {
    parts.push(`${labels.features}:\n${features.map((f) => `• ${f}`).join("\n")}`);
  }
  return {
    text: parts.join("\n\n"),
    videoUrl: entry.videoUrl && /^https?:\/\//.test(entry.videoUrl) ? entry.videoUrl : null,
  };
}