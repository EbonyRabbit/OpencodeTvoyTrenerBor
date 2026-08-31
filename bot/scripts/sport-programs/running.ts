/**
 * Running - силовая база для бегуна (12 недель, 3 дня, средний уровень).
 *
 * Построен по методике «Анализ потребностей → Макро-блоки → Микро».
 * Структура (финал): Дни 1 и 2 - Full Body (низ+верх, баланс ВП/ГП/ВЖ/ГЖ),
 * День 3 - Кондиция+Кор (ОФП). Взрывная работа - строго в начале дня
 * (после разминки), только фаза power (нед 9-11).
 *
 * Бег на трассе клиент делает с другим тренером - здесь только зальная ОФП.
 *
 * Run from bot/ together with seed-running-program.ts:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/seed-running-program.ts
 */
import type {
  ParsedContent,
  ParsedWeek,
  ParsedDay,
  ParsedExercise,
} from "../../src/lib/program-utils.js";

type Phase = "foundation" | "hypertrophy" | "strength" | "power" | "deload";

function phaseForWeek(w: number): Phase {
  if (w <= 2) return "foundation";
  if (w <= 4) return "hypertrophy";
  if (w <= 8) return "strength";
  if (w <= 11) return "power";
  return "deload";
}

const WEEK_LABEL: Record<Phase, string> = {
  foundation: "База: техника + активация",
  hypertrophy: "Гипертрофия + сила НЧ",
  strength: "Сила + одноопорная",
  power: "Мощь + плиометрика + ВИИТ",
  deload: "Разгрузка",
};

const PHASE_PRESCRIPTION: Record<
  Phase,
  { sets: string; reps: string; rpe: string; pct: string; tempo: string; rest: string }
> = {
  foundation: { sets: "2-3", reps: "12-15", rpe: "6-7", pct: "%ПМ 60-65", tempo: "21X1", rest: "60-90с" },
  hypertrophy: { sets: "3", reps: "10-12", rpe: "7-8", pct: "%ПМ 67-72", tempo: "21X1", rest: "90с" },
  strength: { sets: "4", reps: "6-10", rpe: "8", pct: "%ПМ 75-82", tempo: "21X1", rest: "120с" },
  power: { sets: "4", reps: "4-6", rpe: "8-9", pct: "%ПМ 80-85", tempo: "X0X1", rest: "120с" },
  deload: { sets: "2", reps: "10-12", rpe: "5-6", pct: "%ПМ 50-55", tempo: "20X1", rest: "60с" },
};

function strength(
  phase: Phase,
  block: string,
  name: string,
  extraNote = "",
): ParsedExercise {
  const p = PHASE_PRESCRIPTION[phase];
  const note = `${p.pct}, темп ${p.tempo}${extraNote ? `. ${extraNote}` : ""}`.trim();
  return { block, name, sets: p.sets, reps: p.reps, rpe: p.rpe, rest: p.rest, notes: note };
}

function core(phase: Phase, name: string, reps: string, note: string): ParsedExercise {
  const p = PHASE_PRESCRIPTION[phase];
  return { block: "Кор", name, sets: p.sets, reps, rpe: "7", rest: "60с", notes: note };
}

function cond(phase: Phase, name: string, reps: string, note: string): ParsedExercise {
  const p = PHASE_PRESCRIPTION[phase];
  return { block: "Кондиция", name, sets: p.sets, reps, rpe: "7", rest: "90с", notes: note };
}

function explosive(
  phase: Phase,
  block: string,
  name: string,
  reps: string,
  note: string,
): ParsedExercise | null {
  if (phase !== "power") return null;
  return { block, name, sets: "3", reps, rpe: "7", rest: "90с", notes: note };
}

function warmup(): ParsedExercise {
  return {
    block: "Разминка",
    name: "Разминка: динамика + мобильность ТБС/голеностоп + активация ягодиц",
  };
}

function buildDayA(w: number, phase: Phase): ParsedExercise[] {
  const ex: ParsedExercise[] = [warmup()];
  const e1 = explosive(phase, "Плиометрика", "Барьерные выпрыгивания", "4", "горизонтальная плио (bounding); мягкое приземление");
  if (e1) ex.push(e1);
  ex.push(strength(phase, "Сила", "Румынская тяга с гантелями", "ЗС; нейтраль позвоночника, без округления"));
  ex.push(strength(phase, "Сила", "Ягодичный мост", "УС - пик в укороченном состоянии"));
  ex.push(strength(phase, "Сила", "Подъем на носки (икры)", "икры/ахилл - полная амплитуда, 2с эксцентрика ниже опоры; прямое колено - икроножная, согнутое - камбаловидная - при боли в ахилле стоп"));
  ex.push(strength(phase, "Тяга", "Тяга верхнего блока", "широчайшие; против сутулости от бега (ВП)"));
  ex.push(strength(phase, "Манжета", "Тяга к лицу", "задняя дельта/трапеция - здоровье плеча (ГП)"));
  ex.push(strength(phase, "Жим", "Жим гантелей на наклонной", "грудь/дельты; горизонтальный жим (ГЖ)"));
  ex.push(strength(phase, "Жим", "Жим гантелей стоя", "вертикальный жим; осанка/руки (ВЖ)"));
  ex.push(core(phase, "Паллоф-пресс", "10-12/сторону", "антиротация кор - защита поясницы"));
  return ex;
}

function buildDayB(w: number, phase: Phase): ParsedExercise[] {
  const ex: ParsedExercise[] = [warmup()];
  const e1 = explosive(phase, "Плиометрика", "Боковые запрыгивания/приземления", "5/сторону", "латеральная плио; мягкое приземление без вальгуса");
  if (e1) ex.push(e1);
  ex.push(strength(phase, "Сила", "Приседания со штангой", "квад/ягод; техника важнее веса"));
  ex.push(strength(phase, "Сила", "Болгарские выпады", "одностороннее квад/ягод"));
  ex.push(strength(phase, "Сила", "Степ-ап с гантелями", "толчковая нога ведёт"));
  ex.push(strength(phase, "Стабильность", "Ракушка (clamshell)", "glute med; без ротации таза"));
  ex.push(strength(phase, "Профилактика", "Подъём носка на себя (передняя большеберцовая)", "без веса; высокие повторы"));
  ex.push(strength(phase, "Сила", "Односторонняя румынская тяга", "одноопорная ЗЦ; таз без ротации (разнесена с Днём 1)"));
  ex.push(strength(phase, "Тяга", "Подтягивания", "при необходимости - гравитрон (ВП)"));
  ex.push(strength(phase, "Тяга", "Тяга гантели в наклоне", "горизонтальная тяга; широчайшие (ГП)"));
  ex.push(strength(phase, "Жим", "Отжимания", "горизонтальный жим; кор+грудь (ГЖ)"));
  ex.push(core(phase, "Dead bug", "10-12/сторону", "анти-экстензия; стабильность поясницы"));
  return ex;
}

function buildDayC(w: number, phase: Phase): ParsedExercise[] {
  const ex: ParsedExercise[] = [warmup()];
  const e1 = explosive(phase, "Плиометрика", "Барьерные выпрыгивания", "4", "горизонтальная плио; мягкое приземление");
  if (e1) ex.push(e1);
  ex.push(cond(phase, "Трастеры", "12-15", "с гантелями 2×8-16кг; глубокий присед + жим без паузы"));
  ex.push(cond(phase, "Махи гирей", "15-20", "гиря 16-24кг; мощный хип-хиндж, спина нейтральна"));
  ex.push(cond(phase, "Фермерская прогулка", "30-40 м", "осанка/хват/контрлатеральность"));
  ex.push(cond(phase, "Медбол-слэм", "8-10", "взрывная ротация/вертикаль; только после разминки"));
  ex.push(cond(phase, "Бёрпи", "8-10", "кондиция всего тела"));
  ex.push(core(phase, "Планка", "40-60с", "анти-экстензия"));
  ex.push(core(phase, "Планка Копенгагена", "20-40с/сторону", "приводящие + кор - верхняя голень на скамье 30-45см, таз в линии, без провиса"));
  ex.push(core(phase, "Русский твист", "12-15/сторону", "контролируемая ротация"));
  ex.push(strength(phase, "Сила", "Нордические наклоны", "эксцентрика 3-4 с; страховка партнёром"));
  return ex;
}

export function buildRunningProgram(): ParsedContent {
  const weeks: ParsedWeek[] = [];
  for (let w = 1; w <= 12; w++) {
    const phase = phaseForWeek(w);
    const days: ParsedDay[] = [
      { day_name: "День 1 - Full Body (низ+верх)", day_order: 1, focus: "ЗС/ягод + тяга/жим (ВП/ГП/ГЖ/ВЖ)", exercises: buildDayA(w, phase) },
      { day_name: "День 2 - Full Body (низ+верх)", day_order: 2, focus: "Квад/привод + тяга/жим/ротаторы (ВП/ГП/ГЖ)", exercises: buildDayB(w, phase) },
      { day_name: "День 3 - Кондиция + Кор (ОФП)", day_order: 3, focus: "Трастеры/махи/фермерская/слэм/бёрпи + кор", exercises: buildDayC(w, phase) },
    ];
    weeks.push({ week_number: w, week_label: WEEK_LABEL[phase], is_deload: phase === "deload", days });
  }

  return {
    program_name: "Running - силовая база (12 нед, 3 дня)",
    generated_at: new Date().toISOString(),
    version: 1,
    weeks,
    notes: [
      "Спорт-специфичный шаблон: бег - одноопорное, повторяющееся движение с высокой нагрузкой на НЧ.",
      "Дни 1/2 - Full Body (низ+верх) с балансом вертикальных/горизонтальных тяг и жимов.",
      "День 3 - зальная ОФП (кондиция+кор); бег на трассе - вне шаблона (клиент с другим тренером).",
      "Взрывная/плиометрика - строго в начале дня, только фаза power (нед 9-11) - разгрузка без нее.",
      "Важно: плиометрика только после разминки; передняя большеберцовая - без веса; при боли в колене/ахилле - снизить объем одностороннего и плио.",
    ],
  };
}
