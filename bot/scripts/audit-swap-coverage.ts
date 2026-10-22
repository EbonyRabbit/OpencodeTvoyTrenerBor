/**
 * Аудит покрытия замен упражнений.
 *
 * Для каждого рабочего упражнения всех программ проверяет:
 *   - есть ли оно в библиотеке (по name_key/алиасам);
 *   - заполнена ли каноническая группа мышц;
 *   - есть ли хотя бы один кандидат на замену в той же группе.
 *
 * Run from bot/:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/audit-swap-coverage.ts
 */
import "dotenv/config";
import { supabaseAdmin } from "../src/lib/supabase-admin.js";
import { normalizeExerciseName } from "../src/lib/exercise-library.js";
import { EXERCISE_GROUPS, EXERCISE_GROUP_FALLBACKS, type ExerciseGroup } from "../src/lib/exercise-groups.js";
import { exerciseKind, getParsedContent, type ParsedExercise } from "../src/lib/program-utils.js";

interface LibraryRow {
  id: string;
  name: string;
  name_key: string;
  aliases: string[] | null;
  muscle_group: string | null;
  equipment: string | null;
}

interface Problem {
  program: string;
  name: string;
  reason: string;
}

const canonicalGroups = new Set<string>(EXERCISE_GROUPS);

// Служебные блоки, которым замена не нужна (это не одно упражнение).
const SERVICE_NAMES = new Set(["Кор-круг", "Мобильность"]);

async function main(): Promise<void> {
  const { data: libraryRows, error: libraryError } = await supabaseAdmin
    .from("exercises")
    .select("id, name, name_key, aliases, muscle_group, equipment");
  if (libraryError) {
    console.error("Не удалось загрузить библиотеку:", libraryError.message);
    process.exit(1);
  }

  const library = (libraryRows ?? []) as LibraryRow[];
  const byKey = new Map<string, LibraryRow>();
  for (const row of library) {
    byKey.set(normalizeExerciseName(row.name_key), row);
    byKey.set(normalizeExerciseName(row.name), row);
    for (const alias of row.aliases ?? []) {
      const key = normalizeExerciseName(alias);
      if (key && !byKey.has(key)) byKey.set(key, row);
    }
  }

  const byGroup = new Map<string, LibraryRow[]>();
  for (const row of library) {
    if (!row.muscle_group) continue;
    const list = byGroup.get(row.muscle_group) ?? [];
    list.push(row);
    byGroup.set(row.muscle_group, list);
  }

  const nonCanonical = library.filter(
    (row) => row.muscle_group && !canonicalGroups.has(row.muscle_group),
  );
  if (nonCanonical.length > 0) {
    console.log(`НЕКАНОНИЧЕСКИЕ ГРУППЫ (${nonCanonical.length}):`);
    for (const row of nonCanonical) {
      console.log(`  - ${row.name}: «${row.muscle_group}»`);
    }
    console.log("");
  }

  const { data: programs, error: programsError } = await supabaseAdmin
    .from("programs")
    .select("title, parsed_content");
  if (programsError) {
    console.error("Не удалось загрузить программы:", programsError.message);
    process.exit(1);
  }

  const problems: Problem[] = [];
  let checked = 0;
  let ok = 0;

  for (const program of programs ?? []) {
    const parsed = getParsedContent(program.parsed_content);
    if (!parsed) continue;

    const targets: ParsedExercise[] = [];
    for (const week of parsed.weeks ?? []) {
      for (const day of week.days ?? []) {
        for (const exercise of day.exercises ?? []) {
          if (exercise.type === "superset" || exercise.type === "circuit") {
            for (const child of exercise.children ?? []) targets.push(child);
          } else {
            targets.push(exercise);
          }
        }
      }
    }

    const seen = new Set<string>();
    let programChecked = 0;
    let programProblems = 0;

    for (const exercise of targets) {
      if (exerciseKind(exercise) !== "work") continue;
      if (SERVICE_NAMES.has(exercise.name.trim())) continue;
      const key = normalizeExerciseName(exercise.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      checked++;
      programChecked++;

      const row = byKey.get(key);
      if (!row) {
        problems.push({ program: program.title, name: exercise.name, reason: "нет в библиотеке" });
        programProblems++;
        continue;
      }
      if (!row.muscle_group) {
        problems.push({ program: program.title, name: exercise.name, reason: "без группы мышц" });
        programProblems++;
        continue;
      }
      if (!canonicalGroups.has(row.muscle_group)) {
        problems.push({
          program: program.title,
          name: exercise.name,
          reason: `неканоническая группа «${row.muscle_group}»`,
        });
        programProblems++;
        continue;
      }
      const sameGroup = (byGroup.get(row.muscle_group) ?? []).filter((c) => c.id !== row.id);
      const fallbacks = (EXERCISE_GROUP_FALLBACKS[row.muscle_group as ExerciseGroup] ?? []).filter(
        (group) => group !== row.muscle_group,
      );
      const candidates =
        sameGroup.length > 0
          ? sameGroup
          : fallbacks
              .flatMap((group) => byGroup.get(group) ?? [])
              .filter((c) => c.id !== row.id);
      if (candidates.length === 0) {
        problems.push({
          program: program.title,
          name: exercise.name,
          reason: `нет кандидатов в группе «${row.muscle_group}»`,
        });
        programProblems++;
        continue;
      }
      ok++;
    }

    console.log(
      `${program.title}: проверено ${programChecked}, проблем ${programProblems}`,
    );
  }

  console.log("");
  console.log(`ИТОГО: проверено ${checked}, ок ${ok}, проблем ${problems.length}`);
  if (problems.length > 0) {
    console.log("");
    for (const problem of problems) {
      console.log(`  [${problem.program}] ${problem.name} — ${problem.reason}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
