import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  normalizeExerciseName,
  buildExerciseLibraryMap,
  findLibraryEntry,
  type ExerciseLibraryRow,
} from "@/lib/exercise-library";

function row(partial: Partial<ExerciseLibraryRow>): ExerciseLibraryRow {
  return {
    id: partial.id ?? "00000000-0000-0000-0000-000000000000",
    name: partial.name ?? "Тест",
    name_key: partial.name_key ?? partial.name ?? "Тест",
    aliases: partial.aliases ?? [],
    description_ru: null,
    description_en: null,
    technique_ru: partial.technique_ru ?? null,
    technique_en: partial.technique_en ?? null,
    features_ru: partial.features_ru ?? [],
    features_en: partial.features_en ?? [],
    video_url: partial.video_url ?? null,
  };
}

describe("web exercise-library resolver (portal)", () => {
  it("stays byte-identical to the bot copy (only import lines differ)", () => {
    const webPath = resolve(__dirname, "exercise-library.ts");
    const botPath = resolve(__dirname, "../../../bot/src/lib/exercise-library.ts");
    const strip = (source: string): string =>
      source
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("import "))
        .filter((line) => !line.includes("MUST stay in sync"))
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n");
    expect(strip(readFileSync(webPath, "utf8"))).toBe(
      strip(readFileSync(botPath, "utf8")),
    );
  });
  it("must stay in sync with the bot copy: normalize strips punctuation and ё", () => {
    expect(normalizeExerciseName("Жим Штанги Лёжа!")).toBe("жимштангилежа");
  });

  it("finds a sequenced exercise by its program name via aliases", () => {
    const map = buildExerciseLibraryMap([
      row({ id: "a", name: "Приседания", aliases: ["Squat", "присед со штангой"] }),
    ]);
    expect(findLibraryEntry(map, "присед со штангой")?.id).toBe("a");
    expect(findLibraryEntry(map, "SQUAT")?.id).toBe("a");
    expect(findLibraryEntry(map, "Выпады")).toBeUndefined();
  });

  it("keeps the first row on duplicate name keys", () => {
    const map = buildExerciseLibraryMap([
      row({ id: "a", name: "Жим лёжа" }),
      row({ id: "b", name: "жим лежа" }),
    ]);
    expect(map.get("жимлежа")?.id).toBe("a");
    expect(map.size).toBe(1);
  });
});