import { describe, it, expect } from "vitest";
import {
  normalizeExerciseName,
  buildExerciseLibraryMap,
  findLibraryEntry,
  collectLibraryKeys,
  formatExerciseInfo,
  type ExerciseLibraryRow,
} from "../exercise-library.js";
import type { ParsedExercise } from "../program-utils.js";

function row(partial: Partial<ExerciseLibraryRow>): ExerciseLibraryRow {
  return {
    id: partial.id ?? "00000000-0000-0000-0000-000000000000",
    name: partial.name ?? "Тест",
    name_key: partial.name_key ?? normalizeExerciseName(partial.name ?? "Тест"),
    aliases: partial.aliases ?? [],
    description_ru: partial.description_ru ?? null,
    description_en: partial.description_en ?? null,
    technique_ru: partial.technique_ru ?? null,
    technique_en: partial.technique_en ?? null,
    features_ru: partial.features_ru ?? [],
    features_en: partial.features_en ?? [],
    video_url: partial.video_url ?? null,
  };
}

describe("normalizeExerciseName", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeExerciseName("Жим Штанги Лёжа!")).toBe("жимштангилежа");
  });

  it("replaces ё with е", () => {
    expect(normalizeExerciseName("Ёл")).toBe("ел");
    expect(normalizeExerciseName("подъём")).toBe("подъем");
  });

  it("normalizes unicode to NFKC", () => {
    expect(normalizeExerciseName("𝓐")).toBe("a");
  });

  it("strips whitespace and internal spaces", () => {
    expect(normalizeExerciseName("  Приседания  со  штангой  ")).toBe("приседаниясоштангой");
  });

  it("keeps digits", () => {
    expect(normalizeExerciseName("Бег 5 км")).toBe("бег5км");
  });
});

describe("buildExerciseLibraryMap", () => {
  it("keys rows by normalized name_key and registers aliases", () => {
    const map = buildExerciseLibraryMap([
      row({ id: "a", name: "Жим лёжа", name_key: "Жим лёжа", aliases: ["Bench Press", "Жим штанги лежа"] }),
    ]);
    expect(map.get("жимлежа")?.id).toBe("a");
    expect(map.get("benchpress")?.id).toBe("a");
    expect(map.get("жимштангилежа")?.id).toBe("a");
  });

  it("skips duplicate keys and empty keys", () => {
    const map = buildExerciseLibraryMap([
      row({ id: "a", name: "Тест", name_key: "Тест" }),
      row({ id: "b", name: "тест", name_key: "тест" }),
      row({ id: "c", name: "!!!", name_key: "!!!" }),
    ]);
    expect(map.get("тест")?.id).toBe("a");
    expect(map.size).toBe(1);
  });

  it("lets a canonical name beat another row's alias (two-phase build)", () => {
    const map = buildExerciseLibraryMap([
      row({ id: "a", name: "Жим", name_key: "Жим", aliases: ["Тяга"] }),
      row({ id: "b", name: "Тяга", name_key: "Тяга" }),
    ]);
    expect(map.get("жим")?.id).toBe("a");
    expect(map.get("тяга")?.id).toBe("b");
  });

  it("registers aliases only when they do not collide with any canonical name", () => {
    const map = buildExerciseLibraryMap([
      row({ id: "a", name: "Болгарские выпады", name_key: "Болгарские выпады" }),
      row({
        id: "b",
        name: "Выпады с гантелями",
        name_key: "Выпады с гантелями",
        aliases: ["Болгарские выпады"],
      }),
    ]);
    expect(map.get("болгарскиевыпады")?.id).toBe("a");
    expect(map.get("выпадысгантелями")?.id).toBe("b");
  });
});

describe("findLibraryEntry", () => {
  it("matches by name and by alias", () => {
    const map = buildExerciseLibraryMap([
      row({ id: "a", name: "Приседания", name_key: "Приседания", aliases: ["Squat"] }),
    ]);
    expect(findLibraryEntry(map, "Приседания")?.id).toBe("a");
    expect(findLibraryEntry(map, "squat")?.id).toBe("a");
    expect(findLibraryEntry(map, "Выпады")).toBeUndefined();
  });
});

describe("collectLibraryKeys", () => {
  it("collects unique keys from leaves including composite children", () => {
    const exercises: ParsedExercise[] = [
      { name: "Жим лёжа", sets: 3, reps: "10" },
      {
        name: "Суперсет",
        type: "superset",
        children: [
          { name: "Тяга гантели", sets: 3, reps: "10" },
          { name: "жим лёжа", sets: 3, reps: "10" },
        ],
      },
    ];
    expect(collectLibraryKeys(exercises)).toEqual(["жимлежа", "тягагантели"]);
  });
});

describe("formatExerciseInfo", () => {
  const entryRow = row({
    name: "Приседания",
    technique_ru: "Шаг 1\nШаг 2",
    technique_en: "Step 1",
    features_ru: ["Колени в сторону носков", "Спина прямая"],
    features_en: ["Knees over toes"],
  });

  it("formats ru with technique and bulleted features", () => {
    const entry = buildExerciseLibraryMap([entryRow]).get("приседания")!;
    const { text, videoUrl } = formatExerciseInfo(entry, "ru");
    expect(text).toContain("Техника:\nШаг 1\nШаг 2");
    expect(text).toContain("Особенности:\n• Колени в сторону носков\n• Спина прямая");
    expect(videoUrl).toBeNull();
  });

  it("falls back ru technique to en when missing", () => {
    const enOnly = buildExerciseLibraryMap([
      row({ name: "Разгибание", technique_en: "Step 1" }),
    ]).get("разгибание")!;
    const { text } = formatExerciseInfo(enOnly, "ru");
    expect(text).toContain("Техника:\nStep 1");
  });

  it("uses en labels and features for en", () => {
    const entry = buildExerciseLibraryMap([entryRow]).get("приседания")!;
    const { text } = formatExerciseInfo(entry, "en");
    expect(text).toContain("Technique:\nStep 1");
    expect(text).toContain("Features:\n• Knees over toes");
    expect(text).not.toContain("Шаг");
  });

  it("falls back to the other language for features when empty", () => {
    const ruOnlyFeatures = buildExerciseLibraryMap([
      row({
        name: "Тяга",
        technique_en: "Step 1",
        features_ru: ["Спина ровная"],
      }),
    ]).get("тяга")!;
    const { text } = formatExerciseInfo(ruOnlyFeatures, "en");
    expect(text).toContain("Features:\n• Спина ровная");
  });

  it("passes only http(s) video urls", () => {
    const entry = buildExerciseLibraryMap([
      row({ name: "Жим", video_url: "https://www.youtube.com/watch?v=abc123" }),
    ]).get("жим")!;
    const withVideo = formatExerciseInfo(entry, "ru");
    expect(withVideo.videoUrl).toBe("https://www.youtube.com/watch?v=abc123");

    const entryBad = buildExerciseLibraryMap([
      row({ name: "Тяга", video_url: "ftp://x" }),
      row({ name: "Тяга2", video_url: null }),
    ]).get("тяга")!;
    expect(formatExerciseInfo(entryBad, "ru").videoUrl).toBeNull();
  });
});