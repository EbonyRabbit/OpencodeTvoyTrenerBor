/**
 * Backfill фазы 25: проставляет kind (warmup/cooldown) в parsed_content
 * существующих программ. Только там, где kind отсутствует.
 *
 * Правила (согласованы с Юрием):
 *   warmup:   block содержит «разминка», name == «Мобилизация + активация»,
 *             name начинается с «Разминка:», block == «Активация»
 *   cooldown: block содержит «заминка», name == «Растяжка + восстановление»
 *             или «Растяжка», block == «Восстановление»
 *   «Мобильность» и всё остальное — не трогаем.
 *
 * Безопасность: сначала бэкап таблицы programs_backup_YYYYMMDD,
 * затем dry-run с подсчётом, применение только флагом --apply.
 * Идемпотентно: повторный прогон ничего не меняет.
 *
 * Run from bot/:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/backfill-exercise-kind.ts --dry-run
 *   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/backfill-exercise-kind.ts --apply
 */
import "dotenv/config";
import { supabaseAdmin } from "../src/lib/supabase-admin.js";
import { getParsedContent } from "../src/lib/program-utils.js";
import type { ExerciseKind, ParsedExercise } from "../src/lib/program-utils.js";

function backfillKind(ex: { kind?: string; block?: string; name: string }): ExerciseKind | null {
  if (ex.kind === "warmup" || ex.kind === "cooldown" || ex.kind === "work") return null;
  const block = (ex.block ?? "").trim().toLowerCase();
  const name = (ex.name ?? "").trim().toLowerCase();
  if (
    block.includes("разминка") ||
    block === "активация" ||
    name.startsWith("разминка:") ||
    name === "мобилизация + активация"
  ) {
    return "warmup";
  }
  if (
    block.includes("заминка") ||
    block === "восстановление" ||
    name === "растяжка + восстановление" ||
    name === "растяжка"
  ) {
    return "cooldown";
  }
  return null;
}

function walk(list: ParsedExercise[], counter: { warmup: number; cooldown: number }): boolean {
  let changed = false;
  for (const ex of list) {
    const kind = backfillKind(ex);
    if (kind) {
      ex.kind = kind;
      counter[kind] += 1;
      changed = true;
    }
    if (ex.children?.length && walk(ex.children, counter)) changed = true;
  }
  return changed;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const mode = apply ? "APPLY" : "DRY-RUN";

  const { data: programs, error } = await supabaseAdmin
    .from("programs")
    .select("id, title, parsed_content");
  if (error || !programs) {
    console.error(`[${mode}] fetch programs failed:`, error?.message);
    process.exit(1);
  }

  if (apply) {
    const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    // Бэкап: снепшот всех программ в JSON рядом со скриптом (откат — заливка назад).
    const fs = await import("node:fs");
    fs.writeFileSync(
      new URL(`./programs-backup-${stamp}.json`, import.meta.url),
      JSON.stringify(programs, null, 1),
    );
    console.log(`[${mode}] backup: ${programs.length} programs → scripts/programs-backup-${stamp}.json`);
  }

  let touched = 0;
  for (const p of programs as { id: string; title: string; parsed_content: unknown }[]) {
    const parsed = getParsedContent(p.parsed_content as never);
    if (!parsed?.weeks) continue;
    const counter = { warmup: 0, cooldown: 0 };
    let changed = false;
    for (const w of parsed.weeks) {
      for (const d of w.days ?? []) {
        if (d.exercises?.length && walk(d.exercises, counter)) changed = true;
      }
    }
    if (!changed) continue;
    touched += 1;
    console.log(`[${mode}] ${p.title}: +${counter.warmup} warmup, +${counter.cooldown} cooldown`);
    if (apply) {
      const { error: upErr } = await supabaseAdmin
        .from("programs")
        .update({ parsed_content: parsed as never })
        .eq("id", p.id);
      if (upErr) {
        console.error(`[${mode}] update failed for ${p.id}:`, upErr.message);
        process.exit(1);
      }
    }
  }
  console.log(`[${mode}] done: ${touched}/${programs.length} programs ${apply ? "updated" : "would update"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
