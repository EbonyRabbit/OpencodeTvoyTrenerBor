/**
 * Seed: Домашний Full Body 10 недель (3 тренировки/нед, каждая — фулбоди).
 *
 * Оборудование: разборные гантели 5–40 кг + коврик.
 *
 * Макроцикл: 4 нагрузочных → 1 восстановительная → 4 нагрузочных →
 * 1 восстановительная. Без пирамиды: цикл завершается нагрузкой (W9, RPE 9)
 * и разгрузочной неделей (W10).
 *
 * Каждая тренировка: 5 суперсетов (ноги+жим/отведения, таз+тяга,
 * жим+бицепс, тяга+трицепс, кор) + разминка/заминка.
 * Линейная прогрессия: +2.5% верх / +5% низ при выполнении диапазона
 * (шаг = ближайший доступный вес разборных гантелей).
 *
 * Идемпотентно: ищет программу по названию.
 *
 * Run from bot/:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/seed-home-fullbody.ts
 */
import "dotenv/config";
import { supabaseAdmin } from "../src/lib/supabase-admin.js";
import { getParsedContent } from "../src/lib/program-utils.js";
import type { Json } from "../src/lib/types.js";
import type { ParsedContent, ParsedDay, ParsedExercise, ParsedWeek } from "../src/lib/program-utils.js";

const PROGRAM_TITLE = "Домашний Full Body 10 недель";
const DESCRIPTION =
  "Домашняя гипертрофия: 3 тренировки в неделю, каждая — фулбоди, только гантели 5–40 кг и коврик. 5 суперсетов: ноги+жим/отведения, таз+тяга, жим+бицепс, тяга+трицепс, кор. Макроцикл 4+1+4+1: нагрузка → восстановление → нагрузка → восстановление, без пирамиды. Линейная прогрессия рабочих весов.";
const EQUIPMENT = "Разборные гантели 5–40 кг, коврик, стул (для сплит-приседаний)";

type Phase = "load1" | "recovery" | "load2";

const WEEK_PHASE: Record<number, Phase> = {
  1: "load1", 2: "load1", 3: "load1", 4: "load1", 5: "recovery",
  6: "load2", 7: "load2", 8: "load2", 9: "load2", 10: "recovery",
};

type Prog = {
  sets: string;
  reps: string;
  weight: string;
  rpe: string;
  rest: string;
};

const LOAD1: Record<number, Prog> = {
  1: { sets: "4", reps: "10-12", weight: "рабочий", rpe: "7", rest: "120 с" },
  2: { sets: "4", reps: "10-12", weight: "рабочий +2.5%", rpe: "7-8", rest: "120 с" },
  3: { sets: "4", reps: "8-10", weight: "рабочий +5%", rpe: "8", rest: "120 с" },
  4: { sets: "4", reps: "8-10", weight: "рабочий +7.5%", rpe: "8-9", rest: "120 с" },
};

const LOAD2: Record<number, Prog> = {
  6: { sets: "4", reps: "8-10", weight: "рабочий", rpe: "7-8", rest: "120 с" },
  7: { sets: "4", reps: "8", weight: "рабочий +2.5%", rpe: "8", rest: "120 с" },
  8: { sets: "4", reps: "6-8", weight: "рабочий +5%", rpe: "8-9", rest: "120 с" },
  9: { sets: "4", reps: "6-8", weight: "рабочий +7.5%", rpe: "9", rest: "120 с" },
};

const RECOVERY: Prog = { sets: "3", reps: "12", weight: "рабочий −20%", rpe: "6", rest: "90 с" };

const CORE: Record<Phase, { sets: string; rpe: string }> = {
  load1: { sets: "3", rpe: "7-8" },
  load2: { sets: "3", rpe: "7-8" },
  recovery: { sets: "2", rpe: "6" },
};

const NO_FAILURE_NOTE = "Последний подход до RPE 9 — НЕ до отказа (безопасность техники)";

// ======================
// HELPERS
// ======================

function ex(
  name: string,
  sets: string,
  reps: string,
  weight = "",
  rpe = "",
  rest = "",
  notes = "",
  block = "Сила (основное)",
): ParsedExercise {
  return { block, name, sets, reps, weight, rpe, rest, notes };
}

function warmup(): ParsedExercise {
  return ex(
    "Мобилизация + активация",
    "1",
    "10 мин",
    "",
    "",
    "",
    "Суставная гимнастика, лёгкое кардио, активация ягодиц и лопаток",
    "Разминка",
  );
}

function cooldown(): ParsedExercise {
  return ex("Растяжка + восстановление", "1", "10 мин", "", "", "", "Растяжка основных групп на коврике", "Заминка");
}

function superset(name: string, prog: Prog, children: ParsedExercise[], notes: string): ParsedExercise {
  return {
    type: "superset",
    block: name,
    name,
    sets: prog.sets,
    rest: prog.rest,
    notes,
    children,
  };
}

function child(name: string, prog: Prog, extra: Partial<ParsedExercise> = {}): ParsedExercise {
  return { name, sets: prog.sets, reps: prog.reps, weight: prog.weight, rpe: prog.rpe, ...extra };
}

function getProg(week: number, phase: Phase): Prog {
  if (phase === "load1") return LOAD1[week];
  if (phase === "load2") return LOAD2[week];
  return RECOVERY;
}

function coreSuperset(name: string, phase: Phase, children: ParsedExercise[]): ParsedExercise {
  const c = CORE[phase];
  return {
    type: "superset",
    block: name,
    name,
    sets: c.sets,
    rest: "60 с",
    notes: "Без пауз между упражнениями. Отдых между суперсетами 60 с.",
    children,
  };
}

// ======================
// DAY BUILDERS
// ======================

function buildDayA(week: number, phase: Phase): ParsedDay {
  const p = getProg(week, phase);
  const ssNote = `Без пауз между упражнениями. Отдых между суперсетами ${p.rest}.`;

  return {
    day_name: "Тренировка A · Фулбоди",
    day_order: 1,
    focus: "База: гоблет-присед, жим стоя, румынская тяга, тяги в наклоне",
    exercises: [
      warmup(),
      superset("Суперсет 1 · Колено-дом + вертикальный жим", p, [
        child("Гоблет-приседания", p, { notes: NO_FAILURE_NOTE }),
        child("Жим гантелей стоя", p),
      ], ssNote),
      superset("Суперсет 2 · Тазо-дом + тяга", p, [
        child("Румынская тяга с гантелями", p, { notes: NO_FAILURE_NOTE }),
        child("Тяга гантелей к поясу (двумя руками, стоя в наклоне)", p),
      ], ssNote),
      superset("Суперсет 3 · Горизонтальный жим + бицепс", p, [
        child("Жим гантелей лёжа на полу (коврик)", p),
        child("Сгибания рук с гантелями", p),
      ], ssNote),
      superset("Суперсет 4 · Горизонтальная тяга + трицепс", p, [
        child("Тяга гантели одной рукой в упоре на колено", p),
        child("Французский жим лёжа на полу (на коврике)", p),
      ], ssNote),
      coreSuperset("Суперсет 5 · Кор", phase, [
        { name: "Планка", sets: CORE[phase].sets, reps: "30-60 с", rpe: CORE[phase].rpe },
        { name: "Подъёмы ног лёжа", sets: CORE[phase].sets, reps: "10-15", rpe: CORE[phase].rpe },
      ]),
      cooldown(),
    ],
  };
}

function buildDayB(week: number, phase: Phase): ParsedDay {
  const p = getProg(week, phase);
  const ssNote = `Без пауз между упражнениями. Отдых между суперсетами ${p.rest}.`;

  return {
    day_name: "Тренировка B · Фулбоди",
    day_order: 2,
    focus: "Работа на полу и изоляция: выпады, отведения плеч, казак-приседания, тяга горилла",
    exercises: [
      warmup(),
      superset("Суперсет 1 · Колено-дом + отведения плеч", p, [
        child("Выпады назад с гантелями", p, { reps: `${p.reps}/нога`, notes: NO_FAILURE_NOTE }),
        { name: "Отведения плеч с гантелями", sets: p.sets, reps: "15", weight: "лёгкий", rpe: "7" },
      ], ssNote),
      superset("Суперсет 2 · Тазо-дом + тяга", p, [
        child("Казак-приседания", p, { reps: `${p.reps}/нога`, notes: NO_FAILURE_NOTE }),
        child("Тяга горилла (попеременно)", p, { reps: `${p.reps}/рука` }),
      ], ssNote),
      superset("Суперсет 3 · Горизонтальный жим + бицепс", p, [
        child("Отжимания от пола (носки / колени)", p, { weight: "свой вес" }),
        child("Молотки с гантелями", p),
      ], ssNote),
      superset("Суперсет 4 · Горизонтальная тяга + трицепс", p, [
        child("Тяга гантелей в наклоне (двумя руками)", p, { notes: "Тяга к груди, локти широко" }),
        child("Разгибания рук на трицепс из-за головы", p),
      ], ssNote),
      coreSuperset("Суперсет 5 · Кор", phase, [
        { name: "Русский твист с гантелью", sets: CORE[phase].sets, reps: "15-20", rpe: CORE[phase].rpe },
        { name: "Bird-dog", sets: CORE[phase].sets, reps: "30-60 с", rpe: CORE[phase].rpe },
      ]),
      cooldown(),
    ],
  };
}

function buildDayC(week: number, phase: Phase): ParsedDay {
  const p = getProg(week, phase);
  const ssNote = `Без пауз между упражнениями. Отдых между суперсетами ${p.rest}.`;

  return {
    day_name: "Тренировка C · Фулбоди",
    day_order: 3,
    focus: "Односторонняя работа: сплит-присед, румынская на одной ноге, протяжка+жим одной рукой",
    exercises: [
      warmup(),
      superset("Суперсет 1 · Колено-дом + тяга стоя к груди", p, [
        child("Сплит-приседания (болгарские, опора на стул)", p, { reps: `${p.reps}/нога`, notes: NO_FAILURE_NOTE }),
        child("Тяга гантелей стоя к груди", p),
      ], ssNote),
      superset("Суперсет 2 · Тазо-дом + тяга", p, [
        child("Румынская тяга на одной ноге (гантель в руке)", p, { reps: `${p.reps}/нога`, notes: NO_FAILURE_NOTE }),
        child("Протяжка и жим вверх одной рукой (в упоре на колено)", p, { reps: `${p.reps}/рука` }),
      ], ssNote),
      superset("Суперсет 3 · Горизонтальный жим + бицепс", p, [
        child("Узкие отжимания", p, { weight: "свой вес" }),
        child("Сгибания рук с супинацией", p),
      ], ssNote),
      superset("Суперсет 4 · Горизонтальная тяга + трицепс", p, [
        child("Ренегат-тяга (в упоре на гантели)", p),
        { name: "Подъёмы на прямые руки из планки на локтях", sets: p.sets, reps: "8-10", weight: "свой вес", rpe: p.rpe },
      ], ssNote),
      coreSuperset("Суперсет 5 · Кор", phase, [
        { name: "V-складки (V-up)", sets: CORE[phase].sets, reps: "15-20", rpe: CORE[phase].rpe },
        { name: "Боковая планка", sets: CORE[phase].sets, reps: "30-60 с/сторона", rpe: CORE[phase].rpe },
      ]),
      cooldown(),
    ],
  };
}

// ======================
// WEEKS ASSEMBLY
// ======================

const WEEK_LABELS: Record<number, { label: string; focus: string }> = {
  1: { label: "Нагрузка 1 · Неделя 1", focus: "4×10-12, рабочий вес, RPE 7" },
  2: { label: "Нагрузка 1 · Неделя 2", focus: "4×10-12, рабочий +2.5%, RPE 7-8" },
  3: { label: "Нагрузка 1 · Неделя 3", focus: "4×8-10, рабочий +5%, RPE 8" },
  4: { label: "Нагрузка 1 · Неделя 4", focus: "4×8-10, рабочий +7.5%, RPE 8-9" },
  5: { label: "Восстановительная", focus: "3×12, рабочий −20%, RPE ≤ 6" },
  6: { label: "Нагрузка 2 · Неделя 6", focus: "4×8-10, рабочий (выше блока 1), RPE 7-8" },
  7: { label: "Нагрузка 2 · Неделя 7", focus: "4×8, рабочий +2.5%, RPE 8" },
  8: { label: "Нагрузка 2 · Неделя 8", focus: "4×6-8, рабочий +5%, RPE 8-9" },
  9: { label: "Нагрузка 2 · Неделя 9", focus: "4×6-8, рабочий +7.5%, RPE 9" },
  10: { label: "Восстановительная · финал", focus: "3×12, рабочий −20%, RPE ≤ 6. Цикл завершён" },
};

function buildWeeks(): ParsedWeek[] {
  const weeks: ParsedWeek[] = [];
  for (let w = 1; w <= 10; w++) {
    const phase = WEEK_PHASE[w];
    const meta = WEEK_LABELS[w];
    weeks.push({
      week_number: w,
      week_label: `${meta.label} · ${meta.focus}`,
      is_deload: phase === "recovery",
      days: [buildDayA(w, phase), buildDayB(w, phase), buildDayC(w, phase)],
    });
  }
  return weeks;
}

const PROGRAM_NOTES = [
  "Схема недели: 3 фулбоди-тренировки (A — Пн, B — Ср, C — Пт). Каждая: 5 суперсетов — ноги+жим (A) / отведения плеч (B) / тяга стоя к груди (C), таз+тяга, жим+бицепс, тяга+трицепс, кор.",
  "Инвентарь: только разборные гантели 5–40 кг и коврик. Стул нужен для сплит-приседаний (Тренировка C).",
  "Суперсеты: без пауз между упражнениями в паре, отдых между парами 120 с (восстановительные недели — 90 с).",
  "Линейная прогрессия: «рабочий» — стартовый рабочий вес, который тренер подбирает под клиента (≈70% от 1ПМ). Шаг указан в таблице: «рабочий +2.5%» = прибавить 2.5% к рабочему весу (+2.5% верх тела, +5% низ тела). С разборными гантелями шаг — ближайший доступный вес (обычно +2.5 кг на гантель); если прибавить нечего, добавь +2 повтора к верхней границе диапазона.",
  "Второй блок (недели 6-9) начинается с веса выше финала первого блока: линейная прогрессия продолжается без сброса к старту.",
  "Восстановительные недели (5-я и 10-я) обязательны: 3×12, вес −20%, RPE ≤ 6. Это не пропуск тренировок, а снижение нагрузки.",
  "Цикл БЕЗ пирамиды: финал — нагрузочная неделя 9 (RPE 9) и разгрузочная неделя 10. Приседания, румынская тяга, выпады, казак-приседания и сплит-приседания — до RPE 9, НЕ до отказа: риск потери техники.",
  "Ротация упражнений по дням: A — база (гоблет-присед, жим стоя, румынская тяга), B — пол и изоляция (выпады, отведения плеч, казак-приседания, тяга горилла, отжимания), C — односторонняя работа (сплит-присед, румынская на одной ноге, протяжка+жим одной рукой, ренегат-тяга, узкие отжимания, боковая планка).",
  "Сон 7-8 часов, белок 1.6-2 г/кг веса. Техника важнее веса: при нарушении техники вес не добавляй.",
];

function buildContent(): ParsedContent {
  return {
    version: 1,
    program_name: PROGRAM_TITLE,
    generated_at: new Date().toISOString(),
    columns: ["Блок", "Упражнение", "Подходы", "Повторы", "Вес", "RPE", "Отдых", "Заметки"],
    notes: PROGRAM_NOTES,
    weeks: buildWeeks(),
  };
}

// ======================
// UPSERT
// ======================

async function main(): Promise<void> {
  const content = buildContent();
  const parsed = getParsedContent(content as unknown as Json);
  if (!parsed) {
    console.error("ОШИБКА: содержимое программы не прошло валидацию");
    process.exit(1);
  }

  const totalDays = (content.weeks ?? []).reduce((acc, w) => acc + (w.days?.length ?? 0), 0);
  const totalExercises = (content.weeks ?? []).reduce(
    (acc, w) => acc + (w.days ?? []).reduce((d, day) => d + (day.exercises?.length ?? 0), 0),
    0,
  );
  const bytes = new TextEncoder().encode(JSON.stringify(content)).byteLength;
  console.log(`Программа: ${PROGRAM_TITLE}`);
  console.log(`Недель: ${content.weeks?.length}, дней: ${totalDays}, упражнений: ${totalExercises}`);
  console.log(`Размер parsed_content: ${(bytes / 1024).toFixed(1)} КБ`);

  const { data: existing } = await supabaseAdmin
    .from("programs")
    .select("id, title")
    .eq("title", PROGRAM_TITLE)
    .maybeSingle();

  if (existing) {
    const { error } = await supabaseAdmin
      .from("programs")
      .update({
        description: DESCRIPTION,
        equipment: EQUIPMENT,
        duration_weeks: 10,
        type: "template",
        language: "ru",
        active: true,
        parsed_content: content as unknown as Json,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) {
      console.error("ОШИБКА обновления:", error.message);
      process.exit(1);
    }
    console.log(`Обновлена программа: ${existing.id}`);
  } else {
    const { data, error } = await supabaseAdmin
      .from("programs")
      .insert({
        title: PROGRAM_TITLE,
        description: DESCRIPTION,
        equipment: EQUIPMENT,
        price: null,
        template_id: null,
        active: true,
        type: "template",
        language: "ru",
        duration_weeks: 10,
        template_file_url: null,
        parsed_content: content as unknown as Json,
      })
      .select("id")
      .single();
    if (error) {
      console.error("ОШИБКА вставки:", error.message);
      process.exit(1);
    }
    console.log(`Создана программа: ${data?.id}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
