import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalizeExerciseName } from "../src/lib/exercise-library.js";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(SCRIPTS, f), "utf8");

function collectNames(file: string): Set<string> {
  const src = read(file);
  const raw = src.match(/(?:child|ex|machine)\("([^"]+)"/g) ?? [];
  const inline = src.match(/\{\s*[^}]*\bname:\s*"([^"]+)"/g) ?? [];
  const all = new Set<string>();
  for (const m of raw) all.add(m.match(/"([^"]+)"/)![1]);
  for (const m of inline) {
    if (/\btype:\s*"/.test(m)) continue;
    all.add(m.match(/\bname:\s*"([^"]+)"/)![1]);
  }
  if (/cardioRun\(/.test(src)) all.add("Лёгкий бег Z2");
  return all;
}

const files = {
  H: "seed-home-fullbody.ts",
  T: "seed-hypertrophy-fullbody.ts",
  X: "seed-hyrox-program.ts",
};

const libSrc = read("seed-exercise-library.ts");
const blocks = libSrc.split(/\n  \{\n/);
const libKeys: string[] = [];
for (const b of blocks) {
  const nm = b.match(/name:\s*"([^"]+)"/);
  if (nm) {
    libKeys.push(normalizeExerciseName(nm[1]));
    for (const a of b.matchAll(/aliases:\s*\[([^\]]*)\]/g)) {
      const inner = a[1].match(/"[^"]+"/g) ?? [];
      for (const s of inner) libKeys.push(normalizeExerciseName(s.slice(1, -1)));
    }
  }
}

const blockedNames = new Set([
  "Мобилизация + активация",
  "Растяжка + восстановление",
  "Мобильность",
  "Растяжка",
  "Кор-круг",
]);

let missing = 0;
for (const [tag, file] of Object.entries(files)) {
  const names = collectNames(file);
  const unmatched: string[] = [];
  for (const n of [...new Set(names)]) {
    if (blockedNames.has(n) || n.toLowerCase().startsWith("отдых")) continue;
    const nk = normalizeExerciseName(n);
    if (!libKeys.includes(nk)) unmatched.push(n);
  }
  if (unmatched.length) {
    missing += unmatched.length;
    console.log(`${tag} MISSING (${unmatched.length}):`);
    for (const u of unmatched) console.log(`  - ${u}`);
  }
}
console.log(`\nTotal unmatched: ${missing}`);