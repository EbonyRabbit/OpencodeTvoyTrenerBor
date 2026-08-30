/**
 * Seed: Гипертрофия Full Body 12 недель (3 тренировки/нед, каждая - фулбоди).
 *
 * Макроцикл: 4 нагрузочных → 1 восстановительная → 4 нагрузочных →
 * 1 восстановительная → 2 максимальных усилия (пирамида до отказа).
 *
 * Каждая тренировка: 5 суперсетов (колено-дом+верт.жим, тазо-дом+верт.тяга,
 * гор.жим+бицепс, гор.тяга+трицепс, кор) + разминка/заминка.
 * Линейная прогрессия: +2.5% верх / +5% низ при выполнении диапазона.
 * На W3 и W8 вертикальный жим заменяется на отведения + тягу к лицу.
 *
 * Идемпотентно: ищет программу по названию.
 *
 * Run from bot/:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/seed-hypertrophy-fullbody.ts
 */
import "dotenv/config";
import { supabaseAdmin } from "../src/lib/supabase-admin.js";
import { getParsedContent } from "../src/lib/program-utils.js";
import type { Json } from "../src/lib/types.js";
import type { ParsedContent, ParsedDay, ParsedExercise, ParsedWeek } from "../src/lib/program-utils.js";

const PROGRAM_TITLE = "Гипертрофия Full Body 12 недель";
const DESCRIPTION =
  "Гипертрофия: 3 тренировки в неделю, каждая - фулбоди. 5 суперсетов: ноги+вертикальный жим, таз+вертикальная тяга, горизонтальный жим+бицепс, горизонтальная тяга+трицепс, кор. Макроцикл 4+1+4+1+2: нагрузка → восстановление → нагрузка → восстановление → пирамида до отказа. Линейная прогрессия рабочих весов, чередование вертикального жима (W3, W8).";
const EQUIPMENT =
  "Полный зал: штанга, гантели, турник, блоки, тренажёры (жим от груди, горизонтальная тяга, разгибание и сгибание голени сидя)";

type Phase = "load1" | "recovery" | "load2" | "max";

const WEEK_PHASE: Record<number, Phase> = {
  1: "load1", 2: "load1", 3: "load1", 4: "load1", 5: "recovery",
  6: "load2", 7: "load2", 8: "load2", 9: "load2", 10: "recovery",
  11: "max", 12: "max",
};

const ROTATE_WEEKS = new Set([3, 8]);

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

const MAX_W11: Prog = { sets: "4", reps: "12-10-8-6", weight: "пирамида", rpe: "9-10", rest: "150 с" };
const MAX_W12: Prog = { sets: "4", reps: "10-8-6-4", weight: "пирамида", rpe: "9-10", rest: "150 с" };

const CORE: Record<Phase, { sets: string; rpe: string }> = {
  load1: { sets: "3", rpe: "7-8" },
  load2: { sets: "3", rpe: "7-8" },
  recovery: { sets: "2", rpe: "6" },
  max: { sets: "3", rpe: "9-10" },
};

const NO_FAILURE_NOTE = "Последний подход до RPE 9 - НЕ до отказа (безопасность техники)";
const DROPSET_NOTE = "Последний подход до отказа (AMRAP), затем дроп-сет: −20% веса, снова до отказа";

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
  return ex("Растяжка + восстановление", "1", "10 мин", "", "", "", "Фоам-ролл, растяжка основных групп", "Заминка");
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
  if (phase === "recovery") return RECOVERY;
  return week === 11 ? MAX_W11 : MAX_W12;
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
  const rotate = ROTATE_WEEKS.has(week);
  const heavy = phase === "max";
  const ssNote = `Без пауз между упражнениями. Отдых между суперсетами ${p.rest}.`;

  const ss1Children: ParsedExercise[] = [
    child("Приседания со штангой", p, { notes: heavy ? NO_FAILURE_NOTE : "Колено-доминантное" }),
  ];
  if (rotate) {
    ss1Children.push(
      { name: "Отведения гантелей в стороны", sets: p.sets, reps: "15", weight: "лёгкий", rpe: "7", notes: "Чередование: вместо жима вверх" },
      { name: "Тяга к лицу (face pull)", sets: p.sets, reps: "15", weight: "лёгкий", rpe: "7" },
    );
  } else {
    ss1Children.push(child("Жим штанги стоя", p, { notes: heavy ? "Последний подход до отказа (AMRAP)" : "Вертикальный жим" }));
  }

  return {
    day_name: "Тренировка A · Фулбоди",
    day_order: 1,
    focus: "Свободные веса: присед, жим стоя/лёжа, румынская тяга, подтягивания",
    exercises: [
      warmup(),
      superset("Суперсет 1 · Колено-дом + вертикальный жим", p, ss1Children, rotate
        ? `${ssNote} Чередование недели: отведения + тяга к лицу вместо жима вверх.`
        : ssNote),
      superset("Суперсет 2 · Тазо-дом + вертикальная тяга", p, [
        child("Румынская тяга", p, { notes: heavy ? NO_FAILURE_NOTE : "Тазо-доминантное" }),
        child("Подтягивания", p, { weight: heavy ? "пирамида" : "свой вес", notes: heavy ? "Последний подход до отказа (AMRAP)" : "Вертикальная тяга" }),
      ], ssNote),
      superset("Суперсет 3 · Горизонтальный жим + бицепс", p, [
        child("Жим штанги лёжа", p, { notes: heavy ? "Последний подход до отказа (AMRAP)" : "Горизонтальный жим" }),
        child("Сгибания EZ-штанги на бицепс", p, { notes: heavy ? DROPSET_NOTE : "" }),
      ], ssNote),
      superset("Суперсет 4 · Горизонтальная тяга + трицепс", p, [
        child("Тяга штанги в наклоне", p, { notes: heavy ? "Последний подход до отказа (AMRAP)" : "Горизонтальная тяга" }),
        child("Разгибания на трицепс (блок)", p, { notes: heavy ? DROPSET_NOTE : "" }),
      ], ssNote),
      coreSuperset("Суперсет 5 · Кор", phase, [
        { name: "Планка", sets: CORE[phase].sets, reps: "30-60 с", rpe: CORE[phase].rpe },
        { name: "Русский твист", sets: CORE[phase].sets, reps: "15-20", rpe: CORE[phase].rpe, notes: phase === "max" ? "Последний подход до отказа" : "" },
      ]),
      cooldown(),
    ],
  };
}

function buildDayB(week: number, phase: Phase): ParsedDay {
  const p = getProg(week, phase);
  const rotate = ROTATE_WEEKS.has(week);
  const heavy = phase === "max";
  const ssNote = `Без пауз между упражнениями. Отдых между суперсетами ${p.rest}.`;

  const ss1Children: ParsedExercise[] = [
    child("Разгибание голени сидя (тренажёр)", p, { notes: heavy ? NO_FAILURE_NOTE : "Колено-доминантное" }),
  ];
  if (rotate) {
    ss1Children.push(
      { name: "Отведения гантелей в стороны", sets: p.sets, reps: "15", weight: "лёгкий", rpe: "7", notes: "Чередование: вместо жима вверх" },
      { name: "Тяга к лицу (face pull)", sets: p.sets, reps: "15", weight: "лёгкий", rpe: "7" },
    );
  } else {
    ss1Children.push(child("Жим гантелей сидя", p, { notes: heavy ? "Последний подход до отказа (AMRAP)" : "Вертикальный жим" }));
  }

  return {
    day_name: "Тренировка B · Фулбоди",
    day_order: 2,
    focus: "Машины + изоляция: разгибание голени, мост, блок, наклонная скамья",
    exercises: [
      warmup(),
      superset("Суперсет 1 · Колено-дом + вертикальный жим", p, ss1Children, rotate
        ? `${ssNote} Чередование недели: отведения + тяга к лицу вместо жима вверх.`
        : ssNote),
      superset("Суперсет 2 · Тазо-дом + вертикальная тяга", p, [
        child("Ягодичный мост со штангой", p, { notes: heavy ? NO_FAILURE_NOTE : "Тазо-доминантное" }),
        child("Тяга верхнего блока", p, { notes: heavy ? "Последний подход до отказа (AMRAP)" : "Вертикальная тяга" }),
      ], ssNote),
      superset("Суперсет 3 · Горизонтальный жим + бицепс", p, [
        child("Жим гантелей на наклонной", p, { notes: heavy ? "Последний подход до отказа (AMRAP)" : "Горизонтальный жим" }),
        child("Молотки с гантелями", p, { notes: heavy ? DROPSET_NOTE : "" }),
      ], ssNote),
      superset("Суперсет 4 · Горизонтальная тяга + трицепс", p, [
        child("Тяга гантели к поясу", p, { notes: heavy ? "Последний подход до отказа (AMRAP)" : "Горизонтальная тяга" }),
        child("Французский жим (EZ-штанга)", p, { notes: heavy ? DROPSET_NOTE : "" }),
      ], ssNote),
      coreSuperset("Суперсет 5 · Кор", phase, [
        { name: "Подъём ног в висе / лёжа", sets: CORE[phase].sets, reps: "10-15", rpe: CORE[phase].rpe, notes: phase === "max" ? "Последний подход до отказа" : "" },
        { name: "Bird-dog", sets: CORE[phase].sets, reps: "30-60 с", rpe: CORE[phase].rpe },
      ]),
      cooldown(),
    ],
  };
}

function buildDayC(week: number, phase: Phase): ParsedDay {
  const p = getProg(week, phase);
  const rotate = ROTATE_WEEKS.has(week);
  const heavy = phase === "max";
  const ssNote = `Без пауз между упражнениями. Отдых между суперсетами ${p.rest}.`;

  const ss1Children: ParsedExercise[] = [
    child("Выпады в ножницы с гантелями", p, { reps: `${p.reps}/нога`, notes: heavy ? NO_FAILURE_NOTE : "Колено-доминантное" }),
  ];
  if (rotate) {
    ss1Children.push(
      { name: "Отведения гантелей в стороны", sets: p.sets, reps: "15", weight: "лёгкий", rpe: "7", notes: "Чередование: вместо жима вверх" },
      { name: "Тяга к лицу (face pull)", sets: p.sets, reps: "15", weight: "лёгкий", rpe: "7" },
    );
  } else {
    ss1Children.push(child("Жим гантелей стоя", p, { notes: heavy ? "Последний подход до отказа (AMRAP)" : "Вертикальный жим" }));
  }

  return {
    day_name: "Тренировка C · Фулбоди",
    day_order: 3,
    focus: "Односторонняя работа + тренажёры: выпады, сгибание голени, тяга одной рукой",
    exercises: [
      warmup(),
      superset("Суперсет 1 · Колено-дом + вертикальный жим", p, ss1Children, rotate
        ? `${ssNote} Чередование недели: отведения + тяга к лицу вместо жима вверх.`
        : ssNote),
      superset("Суперсет 2 · Тазо-дом + вертикальная тяга", p, [
        child("Сгибание голени сидя (тренажёр)", p, { notes: heavy ? NO_FAILURE_NOTE : "Тазо-доминантное" }),
        child("Вертикальная тяга одной рукой", p, { notes: heavy ? "Последний подход до отказа (AMRAP)" : "Вертикальная тяга" }),
      ], ssNote),
      superset("Суперсет 3 · Горизонтальный жим + бицепс", p, [
        child("Жим в тренажёре от груди", p, { notes: heavy ? "Последний подход до отказа (AMRAP)" : "Горизонтальный жим" }),
        child("Сгибания со штангой на бицепс", p, { notes: heavy ? DROPSET_NOTE : "" }),
      ], ssNote),
      superset("Суперсет 4 · Горизонтальная тяга + трицепс", p, [
        child("Горизонтальная тяга в тренажёре", p, { notes: heavy ? "Последний подход до отказа (AMRAP)" : "Горизонтальная тяга" }),
        child("Разгибания на трицепс над головой", p, { notes: heavy ? DROPSET_NOTE : "" }),
      ], ssNote),
      coreSuperset("Суперсет 5 · Кор", phase, [
        { name: "V-складки", sets: CORE[phase].sets, reps: "15-20", rpe: CORE[phase].rpe, notes: phase === "max" ? "Последний подход до отказа" : "" },
        { name: "Планка", sets: CORE[phase].sets, reps: "30-60 с", rpe: CORE[phase].rpe },
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
  3: { label: "Нагрузка 1 · Неделя 3", focus: "4×8-10, рабочий +5%. Верт. жим → отведения + тяга к лицу" },
  4: { label: "Нагрузка 1 · Неделя 4", focus: "4×8-10, рабочий +7.5%, RPE 8-9" },
  5: { label: "Восстановительная", focus: "3×12, рабочий −20%, RPE ≤ 6" },
  6: { label: "Нагрузка 2 · Неделя 6", focus: "4×8-10, рабочий (выше блока 1), RPE 7-8" },
  7: { label: "Нагрузка 2 · Неделя 7", focus: "4×8, рабочий +2.5%, RPE 8" },
  8: { label: "Нагрузка 2 · Неделя 8", focus: "4×6-8, рабочий +5%. Верт. жим → отведения + тяга к лицу" },
  9: { label: "Нагрузка 2 · Неделя 9", focus: "4×6-8, рабочий +7.5%, RPE 9" },
  10: { label: "Восстановительная", focus: "3×12, рабочий −20%, RPE ≤ 6" },
  11: { label: "Максимальные усилия · Неделя 11", focus: "Пирамида 12-10-8-6, последний подход до отказа" },
  12: { label: "Максимальные усилия · Неделя 12", focus: "Пирамида 10-8-6-4, +2.5-5%, финал цикла" },
};

function buildWeeks(): ParsedWeek[] {
  const weeks: ParsedWeek[] = [];
  for (let w = 1; w <= 12; w++) {
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
  "Схема недели: 3 фулбоди-тренировки (A - Пн, B - Ср, C - Пт). Каждая: 5 суперсетов - колено-дом+верт.жим, тазо-дом+верт.тяга, гор.жим+бицепс, гор.тяга+трицепс, кор.",
  "Суперсеты: без пауз между упражнениями в паре, отдых между парами 120 с (восстановительные недели - 90 с, максимальные усилия - 150 с).",
  "Линейная прогрессия: «рабочий» - стартовый рабочий вес, который тренер подбирает под клиента (≈70% от 1ПМ). Шаг прогрессии указан в таблице: «рабочий +2.5%» = прибавить 2.5% к рабочему весу. Вес добавляется при выполнении всех подходов в верхней границе повторов с запасом (+2.5% верх тела, +5% низ тела).",
  "Второй блок (недели 6-9) начинается с веса выше финала первого блока: линейная прогрессия продолжается без сброса к старту.",
  "Восстановительные недели (5-я и 10-я) обязательны: 3×12, вес −20%, RPE ≤ 6. Это не пропуск тренировок, а снижение нагрузки.",
  "На 3-й и 8-й неделях вертикальный жим заменяется на отведения гантелей (3×15) + тягу к лицу (3×15): снижает нагрузку на плечевой сустав и укрепляет заднюю дельту/ротаторы.",
  "Максимальные усилия (11-12 недели): пирамида 12-10-8-6 → 10-8-6-4, вес растёт от подхода к подходу. До отказа доводятся только безопасные движения: жимы, тяги, подтягивания, изоляция рук, кор.",
  "Приседания, румынская тяга, мост, выпады и машины для ног в пирамиде - до RPE 9, НЕ до отказа: риск потери техники при отказе в тяжёлых движениях.",
  "Дроп-сет на бицепсе/трицепсе (11-12 недели): после отказа в последнем подходе снизь вес на 20% и сделай ещё один подход до отказа.",
  "Ротация упражнений по дням: A - свободные веса (присед, жим стоя/лёжа), B - машины и изоляция (разгибание голени, мост, наклонная), C - односторонняя работа и тренажёры (выпады, сгибание голени, тяга одной рукой).",
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
        duration_weeks: 12,
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
        duration_weeks: 12,
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
