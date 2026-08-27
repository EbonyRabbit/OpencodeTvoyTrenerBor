/**
 * Seed: HYROX 5×12 — подготовка к гонке (12 недель, 5 тренировок/нед).
 *
 * Собирает согласованный грид в parsed_content и вставляет/обновляет
 * программу в Supabase (programs). Идемпотентно: ищет по названию.
 *
 * Run from bot/:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/seed-hyrox-program.ts
 */
import "dotenv/config";
import { supabaseAdmin } from "../src/lib/supabase-admin.js";
import { getParsedContent } from "../src/lib/program-utils.js";
import type { Json } from "../src/lib/types.js";
import type { ParsedContent, ParsedDay, ParsedExercise, ParsedWeek } from "../src/lib/program-utils.js";

const PROGRAM_TITLE = "HYROX 5×12 — подготовка к гонке";
const DESCRIPTION =
  "Подготовка к HYROX: 5 тренировок в неделю. Пн — сила/взрыв + выносливость, Вт — гипертрофия (суперсеты) + AMRAP, Ср — лёгкий бег + кор + мобильность, Чт — сила + станции + темповый бег/брик, Пт — гипертрофия + AMRAP. Фазы: база → развитие → пик → тейпер → гонка. Разгрузки на 4-й и 8-й неделях.";
const EQUIPMENT =
  "Полный зал: штанга, гантели, гири, санки, скиэрг, гребной тренажёр, тумба, санбэг, wall ball 9 кг";

type Phase = "base" | "dev" | "peak" | "taper" | "deload" | "race";

const WEEK_PHASE: Record<number, Phase> = {
  1: "base", 2: "base", 3: "base", 4: "deload",
  5: "dev", 6: "dev", 7: "dev", 8: "deload",
  9: "peak", 10: "peak", 11: "taper", 12: "race",
};

const ROTATE_WEEKS = new Set([3, 7]);

const EASY_RUN_KM: Record<number, number> = {
  1: 4, 2: 5, 3: 6, 4: 4, 5: 6, 6: 7, 7: 8, 8: 5, 9: 8, 10: 10, 11: 6, 12: 3,
};

const CORE_MIN: Record<Phase, string> = {
  base: "15 мин",
  dev: "20 мин",
  peak: "20 мин",
  taper: "12 мин",
  deload: "12 мин",
  race: "10 мин",
};

const STRENGTH: Record<Phase, { sets: string; reps: string; weight: string; rpe: string; rest: string }> = {
  base: { sets: "4", reps: "6-8", weight: "70%", rpe: "7", rest: "90 с" },
  dev: { sets: "4", reps: "6", weight: "80%", rpe: "8", rest: "120 с" },
  peak: { sets: "4", reps: "4-5", weight: "85%", rpe: "8-9", rest: "120 с" },
  taper: { sets: "3", reps: "6", weight: "70%", rpe: "6-7", rest: "90 с" },
  deload: { sets: "3", reps: "6", weight: "65%", rpe: "6", rest: "120 с" },
  race: { sets: "1", reps: "—", weight: "", rpe: "", rest: "" },
};

const POWER: Record<Phase, { sets: string; reps: string; weight: string; rpe: string; rest: string }> = {
  base: { sets: "3", reps: "5", weight: "55%", rpe: "7", rest: "90 с" },
  dev: { sets: "4", reps: "4", weight: "65%", rpe: "8", rest: "90 с" },
  peak: { sets: "3", reps: "3", weight: "70%", rpe: "8", rest: "120 с" },
  taper: { sets: "3", reps: "3", weight: "60%", rpe: "6-7", rest: "90 с" },
  deload: { sets: "3", reps: "3", weight: "50%", rpe: "6", rest: "90 с" },
  race: { sets: "1", reps: "—", weight: "", rpe: "", rest: "" },
};

const WEIGHTED: Record<Phase, { sets: string; reps: string; weight: string; rpe: string }> = {
  base: { sets: "3", reps: "10", weight: "+5 кг", rpe: "7" },
  dev: { sets: "3", reps: "8", weight: "+10 кг", rpe: "8" },
  peak: { sets: "3", reps: "6", weight: "+15 кг", rpe: "8-9" },
  taper: { sets: "2", reps: "8", weight: "+5 кг", rpe: "6-7" },
  deload: { sets: "2", reps: "8", weight: "+2.5 кг", rpe: "6" },
  race: { sets: "1", reps: "—", weight: "", rpe: "" },
};

const ROW: Record<Phase, { sets: string; reps: string; rpe: string; notes: string }> = {
  base: { sets: "4-5", reps: "500 м", rpe: "7", notes: "Отдых 60-90 с между раундами" },
  dev: { sets: "5-6", reps: "500 м", rpe: "8", notes: "Отдых 60-90 с между раундами" },
  peak: { sets: "4-5", reps: "500 м", rpe: "9", notes: "Отдых 90 с между раундами, максимальное качество" },
  taper: { sets: "3", reps: "500 м", rpe: "8", notes: "Отдых 90 с между раундами" },
  deload: { sets: "3", reps: "500 м", rpe: "6", notes: "Лёгкий темп, отдых 90 с" },
  race: { sets: "1", reps: "—", rpe: "", notes: "" },
};

const SLED: Record<Phase, { sets: string; reps: string; weight: string; notes: string }> = {
  base: { sets: "4", reps: "20 м", weight: "60-70 кг", notes: "Техника и адаптация" },
  dev: { sets: "5", reps: "25 м", weight: "70-80 кг", notes: "" },
  peak: { sets: "3", reps: "50 м", weight: "80-102 кг", notes: "Гоночный формат: полная дистанция за раз" },
  taper: { sets: "3", reps: "20 м", weight: "лёгкий", notes: "" },
  deload: { sets: "3", reps: "20 м", weight: "лёгкий", notes: "" },
  race: { sets: "1", reps: "—", weight: "", notes: "" },
};

const BOX_JUMPS: Record<Phase, { sets: string; reps: string; weight: string }> = {
  base: { sets: "3", reps: "8", weight: "тумба 60 см" },
  dev: { sets: "3", reps: "10", weight: "тумба 60 см" },
  peak: { sets: "3", reps: "10", weight: "тумба 75 см" },
  taper: { sets: "2", reps: "8", weight: "тумба 60 см" },
  deload: { sets: "2", reps: "8", weight: "тумба 60 см" },
  race: { sets: "1", reps: "—", weight: "" },
};

const HYP: Record<Phase, { sets: string; reps: string; rpe: string }> = {
  base: { sets: "3", reps: "12-15", rpe: "7" },
  dev: { sets: "4", reps: "12", rpe: "8" },
  peak: { sets: "4", reps: "8", rpe: "8" },
  taper: { sets: "3", reps: "10-12", rpe: "6-7" },
  deload: { sets: "2", reps: "12", rpe: "6" },
  race: { sets: "1", reps: "—", rpe: "" },
};

const HYP_ACC: Record<Phase, { sets: string; reps: string; rpe: string }> = {
  base: { sets: "3", reps: "12-15", rpe: "7" },
  dev: { sets: "4", reps: "12", rpe: "8" },
  peak: { sets: "3", reps: "10-12", rpe: "8" },
  taper: { sets: "3", reps: "10-12", rpe: "6-7" },
  deload: { sets: "2", reps: "12", rpe: "6" },
  race: { sets: "1", reps: "—", rpe: "" },
};

const TEMPO_REST = { sets: "1", reps: "20 мин", rpe: "8", notes: "Пороговый темп (Z3, разговор в 2-3 слова)" };
const TEMPO_DEV = { sets: "1", reps: "25 мин", rpe: "8", notes: "Пороговый темп (Z3)" };
const TEMPO_LIGHT = { sets: "1", reps: "12 мин", rpe: "6", notes: "Лёгкий бег Z1-2" };
const TEMPO_DELOAD = { sets: "1", reps: "15 мин", rpe: "6", notes: "Лёгкий бег Z1-2" };
const TEMPO_TAPER = { sets: "3", reps: "8 мин", rpe: "8", notes: "Пороговый темп, отдых 3 мин между повторами" };

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

function superset(
  name: string,
  sets: string,
  children: ParsedExercise[],
  notes: string,
): ParsedExercise {
  return {
    type: "superset",
    block: "Гипертрофия",
    name,
    sets,
    rest: "60-90 с",
    notes,
    children,
  };
}

function amrap(
  rest: string,
  notes: string,
  children: ParsedExercise[],
): ParsedExercise {
  return {
    type: "circuit",
    block: "AMRAP",
    name: "AMRAP 20 мин",
    sets: "AMRAP",
    rounds: "AMRAP",
    rest,
    notes,
    children,
  };
}

function circuit(name: string, notes: string, children: ParsedExercise[], rounds = "1"): ParsedExercise {
  return {
    type: "circuit",
    block: "Специфика",
    name,
    rounds,
    notes,
    children,
  };
}

function cardioRun(distance: string, pace = "разговорный темп", hr = "65-75% HRmax"): ParsedExercise {
  return {
    type: "cardio",
    block: "Бег",
    name: "Лёгкий бег Z2",
    distance,
    pace,
    heart_rate: hr,
  };
}

function machine(name: string, distance: string, notes: string): ParsedExercise {
  return { block: "Станция", name, sets: "1", reps: distance, notes };
}

function legSupersetChildren(
  legName: string,
  legReps: string,
  legNotes: string,
  pullName: string,
  pullReps: string,
  h: { sets: string; reps: string; rpe: string },
): ParsedExercise[] {
  return [
    { name: legName, sets: h.sets, reps: legReps, weight: "рабочий", rpe: h.rpe, notes: legNotes },
    { name: pullName, sets: h.sets, reps: pullReps, weight: "рабочий", rpe: h.rpe },
  ];
}

// ======================
// DAY BUILDERS
// ======================

function buildDay1(phase: Phase): ParsedDay {
  const s = STRENGTH[phase];
  const p = POWER[phase];
  const w = WEIGHTED[phase];
  const r = ROW[phase];
  return {
    day_name: "Пн — Сила/Взрыв + Выносливость",
    day_order: 1,
    focus: "Присед, жим лёжа, взрывная работа, подтягивания/брусья с весом, гребля",
    exercises: [
      warmup(),
      ex("Приседания со штангой", s.sets, s.reps, s.weight, s.rpe, s.rest),
      ex("Жим штанги лёжа", s.sets, s.reps, s.weight, s.rpe, s.rest),
      ex("Power clean (толчок штанги)", p.sets, p.reps, p.weight, p.rpe, p.rest, "Взрывная работа", "Взрыв"),
      ex("Подтягивания с весом", w.sets, w.reps, w.weight, w.rpe, "90 с", "Добавочный вес на поясе"),
      ex("Брусья с весом", w.sets, w.reps, w.weight, w.rpe, "90 с", "Добавочный вес на поясе"),
      ex("Гребля 500 м", r.sets, r.reps, "", r.rpe, "", r.notes, "Выносливость"),
      cooldown(),
    ],
  };
}

function buildDay2(week: number, phase: Phase): ParsedDay {
  const h = HYP[phase];
  const acc = HYP_ACC[phase];
  const rotate = ROTATE_WEEKS.has(week);
  const restBetween = phase === "deload" ? "120 с" : "60-90 с";
  const ssNote = `Без пауз между упражнениями. Отдых между суперсетами ${restBetween}.`;

  const ss2Children = rotate
    ? [
        { name: "Румынская тяга", sets: h.sets, reps: h.reps, weight: "рабочий", rpe: h.rpe },
        { name: "Отведения гантелей в стороны", sets: h.sets, reps: "15", weight: "лёгкий", rpe: "6-7", notes: "Чередование: вместо жима вверх" },
        { name: "Тяга к лицу (face pull)", sets: h.sets, reps: "15", weight: "лёгкий", rpe: "6-7" },
      ]
    : [
        { name: "Румынская тяга", sets: h.sets, reps: h.reps, weight: "рабочий", rpe: h.rpe },
        { name: "Жим гантелей сидя", sets: h.sets, reps: h.reps, weight: "рабочий", rpe: h.rpe },
      ];

  const day: ParsedDay = {
    day_name: "Вт — Гипертрофия (суперсеты) + AMRAP",
    day_order: 2,
    focus: "8 паттернов в суперсетах: колено/тазо-дом, вертикальные и горизонтальные тяги/жимы, руки",
    exercises: [
      warmup(),
      superset("Суперсет 1 · Ноги + вертикальная тяга", h.sets, [
        { name: "Болгарские выпады", sets: h.sets, reps: `${h.reps}/нога`, weight: "рабочий", rpe: h.rpe, notes: "Колено-доминантное" },
        { name: "Подтягивания", sets: h.sets, reps: h.reps, weight: "свой вес", rpe: h.rpe },
      ], ssNote),
      superset("Суперсет 2 · Тазо-дом + вертикальный жим", h.sets, ss2Children, rotate
        ? `${ssNote} Чередование недели: отведения + тяга к лицу вместо жима вверх.`
        : ssNote),
      superset("Суперсет 3 · Горизонтальная тяга + трицепс", acc.sets, [
        { name: "Тяга гантели к поясу", sets: acc.sets, reps: acc.reps, weight: "рабочий", rpe: acc.rpe, notes: "Горизонтальная тяга" },
        { name: "Разгибания на трицепс (блок)", sets: acc.sets, reps: acc.reps, weight: "рабочий", rpe: acc.rpe },
      ], ssNote),
      superset("Суперсет 4 · Горизонтальный жим + бицепс", acc.sets, [
        { name: "Жим гантелей на наклонной", sets: acc.sets, reps: acc.reps, weight: "рабочий", rpe: acc.rpe, notes: "Горизонтальный жим" },
        { name: "Сгибания на бицепс", sets: acc.sets, reps: acc.reps, weight: "рабочий", rpe: acc.rpe },
      ], ssNote),
    ],
  };

  const amrapEntry = AMRAP_TUE[week];
  if (amrapEntry) {
    day.exercises.push(amrap(amrapEntry.rest, amrapEntry.notes, amrapEntry.children));
  }
  day.exercises.push(cooldown());
  return day;
}

function buildDay3(week: number, phase: Phase): ParsedDay {
  return {
    day_name: "Ср — Лёгкий бег + Кор + Мобильность",
    day_order: 3,
    focus: "Восстановительная работа: аэробная база, кор, мобильность",
    exercises: [
      cardioRun(`${EASY_RUN_KM[week]} км`),
      ex("Кор-круг", "1", CORE_MIN[phase], "", "", "", "Планка, русский твист, bird-dog, подъём ног, супермен — 2-3 круга", "Кор"),
      ex("Мобильность", "1", "15 мин", "", "", "", "ТБ-суставы, грудной отдел, голеностоп, хамстринг", "Мобильность"),
    ],
  };
}

function buildDay4(week: number, phase: Phase): ParsedDay {
  const s = STRENGTH[phase];
  const sled = SLED[phase];
  const box = BOX_JUMPS[phase];

  let tempo: ParsedExercise;
  if (week === 7) {
    tempo = circuit("Брик: четверть гонки", "Непрерывно, отдых = только переходы между станциями", [
      machine("Бег", "1 км", "Гоночный темп"),
      machine("SkiErg", "1000 м", ""),
      machine("Бег", "1 км", "Гоночный темп"),
      machine("Wall Ball", "100 (9 кг)", ""),
    ]);
  } else if (week === 9) {
    tempo = circuit("Брик: четверть гонки", "Непрерывно, отдых = только переходы между станциями", [
      machine("Бег", "1 км", "Гоночный темп"),
      machine("Санки толкать", "50 м", ""),
      machine("Бег", "1 км", "Гоночный темп"),
      machine("Гребля", "1000 м", ""),
    ]);
  } else if (week === 10) {
    tempo = circuit("Брик: половина гонки", "Непрерывно, отдых = только переходы между станциями. 4 км бега + 4 станции на полных дистанциях", [
      machine("Бег", "1 км", "Гоночный темп"),
      machine("SkiErg", "1000 м", ""),
      machine("Бег", "1 км", "Гоночный темп"),
      machine("Санки толкать", "50 м", ""),
      machine("Бег", "1 км", "Гоночный темп"),
      machine("Гребля", "1000 м", ""),
      machine("Бег", "1 км", "Гоночный темп"),
      machine("Wall Ball", "100 (9 кг)", ""),
    ]);
  } else if (phase === "base") {
    tempo = ex("Темповый бег", TEMPO_REST.sets, TEMPO_REST.reps, "", TEMPO_REST.rpe, "", TEMPO_REST.notes, "Бег");
  } else if (phase === "dev") {
    tempo = ex("Темповый бег", TEMPO_DEV.sets, TEMPO_DEV.reps, "", TEMPO_DEV.rpe, "", TEMPO_DEV.notes, "Бег");
  } else if (phase === "taper") {
    tempo = ex("Темповый бег", TEMPO_TAPER.sets, TEMPO_TAPER.reps, "", TEMPO_TAPER.rpe, "3 мин", TEMPO_TAPER.notes, "Бег");
  } else if (phase === "deload") {
    tempo = ex("Лёгкий бег", TEMPO_DELOAD.sets, TEMPO_DELOAD.reps, "", TEMPO_DELOAD.rpe, "", TEMPO_DELOAD.notes, "Бег");
  } else {
    tempo = ex("Лёгкий бег", TEMPO_LIGHT.sets, TEMPO_LIGHT.reps, "", TEMPO_LIGHT.rpe, "", TEMPO_LIGHT.notes, "Бег");
  }

  return {
    day_name: "Чт — Сила + Станции + Бег",
    day_order: 4,
    focus: "Становая, силовой армейский жим, санки, запрыгивания, темповый бег/брик",
    exercises: [
      warmup(),
      ex("Становая тяга", s.sets, s.reps, s.weight, s.rpe, s.rest),
      ex("Армейский жим (силовой)", s.sets, s.reps, s.weight, s.rpe, s.rest),
      ex("Санки толкать", sled.sets, sled.reps, sled.weight, "8-9", "90 с", sled.notes),
      ex("Санки тянуть", sled.sets, sled.reps, sled.weight, "8-9", "90 с", sled.notes),
      ex("Запрыгивания на тумбу", box.sets, box.reps, box.weight, "7-8", "60 с", "Плиометрика: мягкое приземление"),
      tempo,
      cooldown(),
    ],
  };
}

function buildDay5(week: number, phase: Phase): ParsedDay {
  const h = HYP[phase];
  const acc = HYP_ACC[phase];
  const rotate = ROTATE_WEEKS.has(week);
  const restBetween = phase === "deload" ? "120 с" : "60-90 с";
  const ssNote = `Без пауз между упражнениями. Отдых между суперсетами ${restBetween}.`;

  const ss2Children = rotate
    ? [
        { name: "Ягодичный мост с отягощением", sets: h.sets, reps: h.reps, weight: "рабочий", rpe: h.rpe },
        { name: "Отведения гантелей в стороны", sets: h.sets, reps: "15", weight: "лёгкий", rpe: "6-7", notes: "Чередование: вместо жима вверх" },
        { name: "Тяга к лицу (face pull)", sets: h.sets, reps: "15", weight: "лёгкий", rpe: "6-7" },
      ]
    : [
        { name: "Ягодичный мост с отягощением", sets: h.sets, reps: h.reps, weight: "рабочий", rpe: h.rpe },
        { name: "Жим гантелей стоя", sets: h.sets, reps: h.reps, weight: "рабочий", rpe: h.rpe },
      ];

  const day: ParsedDay = {
    day_name: "Пт — Гипертрофия (суперсеты) + AMRAP",
    day_order: 5,
    focus: "8 паттернов в суперсетах: колено/тазо-дом, вертикальные и горизонтальные тяги/жимы, руки",
    exercises: [
      warmup(),
      superset("Суперсет 1 · Ноги + вертикальная тяга", h.sets, [
        { name: "Приседания в ножницы с гантелями", sets: h.sets, reps: `${h.reps}/нога`, weight: "рабочий", rpe: h.rpe, notes: "Колено-доминантное" },
        { name: "Тяга верхнего блока", sets: h.sets, reps: h.reps, weight: "рабочий", rpe: h.rpe },
      ], ssNote),
      superset("Суперсет 2 · Тазо-дом + вертикальный жим", h.sets, ss2Children, rotate
        ? `${ssNote} Чередование недели: отведения + тяга к лицу вместо жима вверх.`
        : ssNote),
      superset("Суперсет 3 · Горизонтальная тяга + трицепс", acc.sets, [
        { name: "Тяга штанги в наклоне", sets: acc.sets, reps: acc.reps, weight: "рабочий", rpe: acc.rpe, notes: "Горизонтальная тяга" },
        { name: "Французский жим (EZ-штанга)", sets: acc.sets, reps: acc.reps, weight: "рабочий", rpe: acc.rpe },
      ], ssNote),
      superset("Суперсет 4 · Горизонтальный жим + бицепс", acc.sets, [
        { name: "Жим гантелей лёжа", sets: acc.sets, reps: acc.reps, weight: "рабочий", rpe: acc.rpe, notes: "Горизонтальный жим" },
        { name: "Сгибания EZ-штангой на бицепс", sets: acc.sets, reps: acc.reps, weight: "рабочий", rpe: acc.rpe },
      ], ssNote),
    ],
  };

  const amrapEntry = AMRAP_FRI[week];
  if (amrapEntry) {
    day.exercises.push(amrap(amrapEntry.rest, amrapEntry.notes, amrapEntry.children));
  }
  day.exercises.push(cooldown());
  return day;
}

// ======================
// AMRAP DATA
// ======================

type AmrapEntry = { rest: string; notes: string; children: ParsedExercise[] };

const AMRAP_TUE: Record<number, AmrapEntry> = {
  1: {
    rest: "90 с",
    notes: "Круг = 1 модальность + упражнения. Бег в темпе 5 км. Фиксируй количество кругов.",
    children: [
      machine("Бег", "400 м", "Темп 5 км"),
      { name: "Трастеры (2×12 кг)", sets: "1", reps: "15", rpe: "8" },
      { name: "Подтягивания", sets: "1", reps: "10" },
    ],
  },
  2: {
    rest: "75 с",
    notes: "Круг = 1 модальность + упражнения. Фиксируй количество кругов.",
    children: [
      machine("Лыжи (SkiErg)", "500 м", ""),
      { name: "Дьявольский жим (2×12 кг)", sets: "1", reps: "12", rpe: "8" },
      { name: "Ноги к перекладине", sets: "1", reps: "10" },
    ],
  },
  3: {
    rest: "60 с",
    notes: "Круг = 1 модальность + упражнения. Фиксируй количество кругов.",
    children: [
      machine("Гребля", "500 м", ""),
      { name: "Махи гирей (24 кг)", sets: "1", reps: "20" },
      { name: "Wall Ball (9 кг)", sets: "1", reps: "12", rpe: "8" },
    ],
  },
  4: {
    rest: "2 мин",
    notes: "Разгрузка: лёгкий круг, не более 4 кругов, без рекордов.",
    children: [
      machine("Бег", "400 м", "Лёгкий темп"),
      { name: "Wall Ball (9 кг)", sets: "1", reps: "10" },
    ],
  },
  5: {
    rest: "90 с",
    notes: "Круг = 1 модальность + упражнения. Фиксируй количество кругов.",
    children: [
      machine("Бег", "400 м", "Темп 5 км"),
      { name: "Толчок гантели (2×14 кг)", sets: "1", reps: "15", rpe: "8" },
      { name: "Фермерская прогулка (2×24 кг)", sets: "1", reps: "100 м" },
    ],
  },
  6: {
    rest: "75 с",
    notes: "Круг = 1 модальность + упражнения. Фиксируй количество кругов.",
    children: [
      machine("Гребля", "500 м", ""),
      { name: "Рывок гантели (2×16 кг)", sets: "1", reps: "8", rpe: "8" },
      { name: "V-складки", sets: "1", reps: "12" },
    ],
  },
  7: {
    rest: "60 с",
    notes: "Круг = 1 модальность + упражнения. Фиксируй количество кругов.",
    children: [
      machine("Лыжи (SkiErg)", "500 м", ""),
      { name: "Wall Ball (9 кг)", sets: "1", reps: "20", rpe: "8" },
      { name: "Запрыгивания на тумбу", sets: "1", reps: "10" },
    ],
  },
  8: {
    rest: "2 мин",
    notes: "Разгрузка: лёгкий круг, без рекордов.",
    children: [
      machine("Лыжи (SkiErg)", "500 м", "Лёгкий темп"),
      { name: "Wall Ball (9 кг)", sets: "1", reps: "10" },
    ],
  },
  9: {
    rest: "45 с",
    notes: "Круг = 1 модальность + упражнения. Фиксируй количество кругов.",
    children: [
      machine("Бег", "400 м", "Темп 5 км"),
      { name: "Рывок гантели (2×16 кг)", sets: "1", reps: "10", rpe: "8" },
      { name: "Махи гирей (24 кг)", sets: "1", reps: "20" },
    ],
  },
  10: {
    rest: "30 с",
    notes: "Гоночный круг: гребля в гоночном темпе. Фиксируй количество кругов.",
    children: [
      machine("Гребля", "500 м", "Гоночный темп"),
      { name: "Трастеры (2×16 кг)", sets: "1", reps: "15", rpe: "8-9" },
      { name: "Фермерская прогулка (2×24 кг)", sets: "1", reps: "100 м" },
    ],
  },
};

const AMRAP_FRI: Record<number, AmrapEntry> = {
  1: {
    rest: "90 с",
    notes: "Круг = 1 модальность + упражнения. Фиксируй количество кругов.",
    children: [
      machine("Лыжи (SkiErg)", "500 м", ""),
      { name: "Махи гирей (24 кг)", sets: "1", reps: "20" },
      { name: "Подтягивания", sets: "1", reps: "10" },
    ],
  },
  2: {
    rest: "75 с",
    notes: "Круг = 1 модальность + упражнения. Фиксируй количество кругов.",
    children: [
      machine("Бег", "400 м", "Темп 5 км"),
      { name: "Дьявольский жим (2×12 кг)", sets: "1", reps: "12", rpe: "8" },
      { name: "V-складки", sets: "1", reps: "12" },
    ],
  },
  3: {
    rest: "60 с",
    notes: "Круг = 1 модальность + упражнения. Фиксируй количество кругов.",
    children: [
      machine("Гребля", "500 м", ""),
      { name: "Толчок гантели (2×14 кг)", sets: "1", reps: "12", rpe: "8" },
      { name: "Выпады с санбэгом (20 кг)", sets: "1", reps: "12" },
    ],
  },
  4: {
    rest: "2 мин",
    notes: "Разгрузка: лёгкий круг, не более 4 кругов, без рекордов.",
    children: [
      machine("Лыжи (SkiErg)", "500 м", "Лёгкий темп"),
      { name: "Wall Ball (9 кг)", sets: "1", reps: "10" },
    ],
  },
  5: {
    rest: "90 с",
    notes: "Круг = 1 модальность + упражнения. Фиксируй количество кругов.",
    children: [
      machine("Гребля", "500 м", ""),
      { name: "Wall Ball (9 кг)", sets: "1", reps: "15", rpe: "8" },
      { name: "Русский твист (16 кг)", sets: "1", reps: "12" },
    ],
  },
  6: {
    rest: "75 с",
    notes: "Круг = 1 модальность + упражнения. Фиксируй количество кругов.",
    children: [
      machine("Лыжи (SkiErg)", "500 м", ""),
      { name: "Дьявольский жим (2×14 кг)", sets: "1", reps: "10", rpe: "8" },
      { name: "Запрыгивания на тумбу", sets: "1", reps: "10" },
    ],
  },
  7: {
    rest: "60 с",
    notes: "Круг = 1 модальность + упражнения. Фиксируй количество кругов.",
    children: [
      machine("Бег", "400 м", "Темп 5 км"),
      { name: "Трастеры (2×14 кг)", sets: "1", reps: "15", rpe: "8" },
      { name: "Фермерская прогулка (2×24 кг)", sets: "1", reps: "100 м" },
    ],
  },
  8: {
    rest: "2 мин",
    notes: "Разгрузка: лёгкий круг, без рекордов.",
    children: [
      machine("Бег", "400 м", "Лёгкий темп"),
      { name: "Wall Ball (9 кг)", sets: "1", reps: "10" },
    ],
  },
  9: {
    rest: "45 с",
    notes: "Круг = 1 модальность + упражнения. Фиксируй количество кругов.",
    children: [
      machine("Лыжи (SkiErg)", "500 м", ""),
      { name: "Трастеры (2×16 кг)", sets: "1", reps: "15", rpe: "8-9" },
      { name: "Заножки (выпады скрестные)", sets: "1", reps: "12" },
    ],
  },
  10: {
    rest: "45 с",
    notes: "Гоночный круг: бег в гоночном темпе. Фиксируй количество кругов.",
    children: [
      machine("Бег", "400 м", "Гоночный темп"),
      { name: "Дьявольский жим (2×16 кг)", sets: "1", reps: "12", rpe: "8-9" },
      { name: "Ноги к перекладине", sets: "1", reps: "15" },
    ],
  },
};

// ======================
// RACE WEEK (W12)
// ======================

function buildRaceWeek(): ParsedDay[] {
  return [
    {
      day_name: "Пн — Лёгкое восстановление",
      day_order: 1,
      focus: "Лёгкая активность перед гонкой",
      exercises: [
        cardioRun("3 км", "очень лёгкий темп", "Z1"),
        ex("Мобильность", "1", "15 мин", "", "", "", "ТБ-суставы, грудной отдел", "Мобильность"),
      ],
    },
    {
      day_name: "Вт — Активация",
      day_order: 2,
      focus: "Проверка техники станций, без утомления",
      exercises: [
        warmup(),
        { block: "Активация", name: "Wall Ball (9 кг)", sets: "3", reps: "10", weight: "9 кг", rpe: "6" },
        { block: "Активация", name: "Гоблет-присед (16 кг)", sets: "3", reps: "10", weight: "16 кг", rpe: "6" },
        { block: "Активация", name: "Бёрпи", sets: "3", reps: "5", rpe: "6" },
        { block: "Активация", name: "Лёгкий бег", sets: "1", reps: "1 км", rpe: "6" },
        cooldown(),
      ],
    },
    {
      day_name: "Ср — Лёгкий бег",
      day_order: 3,
      focus: "Финальная лёгкая сессия",
      exercises: [
        cardioRun("3 км", "очень лёгкий темп", "Z1"),
        ex("Растяжка", "1", "15 мин", "", "", "", "", "Заминка"),
      ],
    },
    {
      day_name: "Чт — Отдых",
      day_order: 4,
      focus: "Полный отдых, лёгкая растяжка",
      exercises: [
        ex("Отдых + лёгкая растяжка", "1", "15 мин", "", "", "", "Никаких нагрузок", "Восстановление"),
      ],
    },
    {
      day_name: "Пт — Подготовка",
      day_order: 5,
      focus: "Отдых перед гонкой",
      exercises: [
        ex("Отдых + подготовка", "1", "—", "", "", "", "Экипировка, документы, ранний сон. Завтра — ГОНКА!", "Восстановление"),
      ],
    },
  ];
}

// ======================
// WEEKS ASSEMBLY
// ======================

const WEEK_LABELS: Record<number, { label: string; focus: string }> = {
  1: { label: "База · Неделя 1", focus: "Фундамент: техника, аэробная база, адаптация" },
  2: { label: "База · Неделя 2", focus: "База: рост объёма и интенсивности" },
  3: { label: "База · Неделя 3", focus: "База: пик первого блока" },
  4: { label: "Разгрузка", focus: "Объём −30–40%, вес 65–70%, RPE ≤ 7" },
  5: { label: "Развитие · Неделя 5", focus: "Развитие: рост интенсивности и специфики" },
  6: { label: "Развитие · Неделя 6", focus: "Развитие: объём и темп растут" },
  7: { label: "Развитие · Неделя 7", focus: "Брик: четверть гонки (SkiErg 1000 м + Wall Ball 100)" },
  8: { label: "Разгрузка", focus: "Объём −30–40%, восстановление" },
  9: { label: "Пик · Неделя 9", focus: "Брик: четверть гонки (Sled Push 50 м + Гребля 1000 м)" },
  10: { label: "Пик · Неделя 10", focus: "Брик: половина гонки — 4 км бега + 4 станции" },
  11: { label: "Тейпер", focus: "Объём −50%, качество сохраняется" },
  12: { label: "Гоночная неделя", focus: "HYROX в субботу. Пн-Ср лёгкая активация, Чт-Пт отдых" },
};

function buildWeeks(): ParsedWeek[] {
  const weeks: ParsedWeek[] = [];
  for (let w = 1; w <= 12; w++) {
    const phase = WEEK_PHASE[w];
    const meta = WEEK_LABELS[w];
    const isDeload = phase === "deload";

    let days: ParsedDay[];
    if (phase === "race") {
      days = buildRaceWeek();
    } else {
      days = [buildDay1(phase), buildDay2(w, phase), buildDay3(w, phase), buildDay4(w, phase), buildDay5(w, phase)];
    }

    weeks.push({
      week_number: w,
      week_label: `${meta.label} · ${meta.focus}`,
      is_deload: isDeload,
      days,
    });
  }
  return weeks;
}

const PROGRAM_NOTES = [
  "Схема недели: Пн — сила/взрыв + выносливость, Вт — гипертрофия (суперсеты) + AMRAP 20 мин, Ср — лёгкий бег + кор + мобильность, Чт — сила + станции + темповый бег/брик, Пт — гипертрофия + AMRAP 20 мин. Сб/Вс — отдых.",
  "Разгрузка на 4-й и 8-й неделях обязательна: объём −30–40%, вес 65–70%, RPE ≤ 7, без брик и тяжёлых санок.",
  "Прогрессия весов: все подходы в верхней границе повторов при RPE ниже заданного → +2.5 кг на следующей неделе.",
  "Бег: длинный бег +10% в неделю; скорость интервалов растёт только при чистой технике.",
  "AMRAP: 20 минут, отдых между кругами по плану (90 → 30 с), фиксируй количество кругов — цель растёт от недели к неделе.",
  "Брик-тренировки: беговые км в гоночном темпе (≈5:00–5:30/км), станции на полных гоночных дистанциях, отдых = только переходы.",
  "Зоны пульса: Z1 55–65% (восстановление), Z2 65–75% (лёгкий бег), Z3 75–85% (пороговый темп), Z4 85–92% (темп 5 км), Z5 92–100% (ускорения).",
  "Сон 7–8 часов, белок 1.6–2 г/кг веса. За 48 часов до гонки — никаких нагрузок.",
  "Гоночные веса станций: Wall Ball 9 кг в тренировках (гонка 6 кг), фермерская 2×24 кг, санки до 102 кг, SkiErg/гребля 1000 м.",
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
