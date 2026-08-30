/**
 * Tennis — sport-specific strength template (12 недель, 3 дня, средний уровень).
 *
 * Построен по методике «Анализ потребностей → Макро-блоки → Микро»:
 * регионы/задачи и блоки — стабильная основа (см. tennis.md), конкретный
 * состав упражнений может меняться тренером без затрагивания основы.
 *
 * Структура (финал): Дни 1 и 2 — Full Body (низ+верх, баланс ВП/ГП/ВЖ/ГЖ),
 * День 3 — Кондиция+Кор (ОФП) с финишем бегом (клиент бегает с другим тренером
 * на трассе, здесь — зальная ОФП + лёгкий финиш-бег). Взрывная работа —
 * строго в начале дня (после разминки), только фаза power (нед 9–11).
 *
 * Run from bot/ together with seed-tennis-program.ts:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/seed-tennis-program.ts
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
  foundation: "База: гипертрофия + мобильность",
  hypertrophy: "Гипертрофия + сила",
  strength: "Сила + ротаторы/ротация",
  power: "Мощь + ВИИТ + навыки",
  deload: "Делoad",
};

const PHASE_PRESCRIPTION: Record<
  Phase,
  { sets: string; reps: string; rpe: string; pct: string; tempo: string; rest: string }
> = {
  foundation: { sets: "3", reps: "12-15", rpe: "7", pct: "%ПМ 60-70", tempo: "21X1", rest: "60-90с" },
  hypertrophy: { sets: "3", reps: "10-12", rpe: "7-8", pct: "%ПМ 65-70", tempo: "21X1", rest: "90с" },
  strength: { sets: "4", reps: "6-10", rpe: "8", pct: "%ПМ 72-80", tempo: "21X1", rest: "90-120с" },
  power: { sets: "4", reps: "4-6", rpe: "8", pct: "%ПМ 80-85", tempo: "X0X1", rest: "120с" },
  deload: { sets: "2", reps: "10-12", rpe: "6", pct: "%ПМ 55-60", tempo: "20X1", rest: "60с" },
};

function strength(
  phase: Phase,
  block: string,
  name: string,
  extraNote = "",
): ParsedExercise {
  const p = PHASE_PRESCRIPTION[phase];
  const note = `${p.pct}, темп ${p.tempo}${extraNote ? `. ${extraNote}` : ""}`.trim();
  return {
    block,
    name,
    sets: p.sets,
    reps: p.reps,
    rpe: p.rpe,
    rest: p.rest,
    notes: note,
  };
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
    name: "Разминка: динамика + мобильность ТБС/плеча + активация ягодиц",
  };
}

function cardioRun(phase: Phase): ParsedExercise {
  if (phase === "foundation" || phase === "deload") {
    return {
      block: "Кондиция",
      name: "Лёгкий бег",
      type: "cardio",
      distance: phase === "deload" ? "4-5 км" : "6-8 км",
      duration: phase === "deload" ? "25-30 мин" : "35-45 мин",
      pace: "комфортный",
      heart_rate: "Z2-Z3",
      notes: "аэробная база; без спринтов (финиш ОФП-дня)",
    };
  }
  if (phase === "power") {
    return {
      block: "Кондиция",
      name: "Лёгкий бег",
      type: "cardio",
      duration: "8-10×(400 м)",
      pace: "темп 5К",
      heart_rate: "Z4-Z5",
      notes: "интервалы после силовой; восстановление между повторами — лёгкий бег/ходьба",
    };
  }
  return {
    block: "Кондиция",
    name: "Лёгкий бег",
    type: "cardio",
    distance: "8-10 км",
    duration: "45-55 мин",
    pace: "комфортный",
    heart_rate: "Z2-Z3",
    notes: "объёмный лёгкий бег",
  };
}

function buildDayA(w: number, phase: Phase): ParsedExercise[] {
  const ex: ParsedExercise[] = [warmup()];
  const e1 = explosive(phase, "Ротация", "Кабель-ротация туловища", "8/сторону", "взрывная X-factor; контроль поясницы, без рывков");
  if (e1) ex.push(e1);
  const e2 = explosive(phase, "Плиометрика", "Запрыгивания на тумбу", "5", "мягкое приземление; только после разминки");
  if (e2) ex.push(e2);
  ex.push(strength(phase, "Сила", "Румянская тяга с гантелями", "ЗС; нейтраль позвоночника, без округления"));
  ex.push(strength(phase, "Сила", "Болгарские выпады", "ЖГ, свободный ЛГС; одноопорная сила"));
  ex.push(strength(phase, "Сила", "Подъём на носки (икры)", "полная амплитуда; можно с весом"));
  ex.push(strength(phase, "Тяга", "Тяга верхнего блока", "широчайшие; против сутулости от игры"));
  ex.push(strength(phase, "Манжета", "Тяга к лицу", "задняя дельта/трапеция — здоровье плеча"));
  ex.push(strength(phase, "Жим", "Жим гантелей на наклонной", "грудь/дельты; горизонтальный жим"));
  ex.push(strength(phase, "Жим", "Жим гантелей стоя", "вертикальный жим; осанка/руки (ВЖ)"));
  ex.push(core(phase, "Паллоф-пресс", "10-12/сторону", "антиротация кор — защита поясницы"));
  return ex;
}

function buildDayB(w: number, phase: Phase): ParsedExercise[] {
  const ex: ParsedExercise[] = [warmup()];
  const e1 = explosive(phase, "Ротация", "Ротационный бросок медбола", "8/сторону", "взрывная ротационная мощь удара; только после разминки");
  if (e1) ex.push(e1);
  ex.push(strength(phase, "Сила", "Ягодичный мостик с гантелью", "УС; пик в укороченном состоянии"));
  ex.push(strength(phase, "Сила", "Боковые выпады", "фронтальная плоскость — COD"));
  ex.push({
    block: "Мобильность",
    name: "Казак-приседания",
    sets: "2-3",
    reps: "8-10/сторону",
    rpe: "6",
    rest: "60с",
    notes: "растяжение приводящих + ротация ТБС + мобильность голеностопа",
  });
  ex.push(strength(phase, "Сила", "Приведение бедра", "декомпрессор при латеральном торможении"));
  ex.push(strength(phase, "Сила", "Отведение бедра (кабель/резинка)", "glute med/min для латеральной стабильности"));
  ex.push(strength(phase, "Тяга", "Подтягивания", "при необходимости — гравитрон (ВП)"));
  ex.push(strength(phase, "Тяга", "Тяга гантели в наклоне", "горизонтальная тяга; широчайшие (ГП)"));
  ex.push(strength(phase, "Жим", "Отжимания", "горизонтальный жим; кор+грудь (ГЖ)"));
  ex.push(strength(phase, "Предплечье", "Молотки с гантелями", "предплечье/хват — буферизация локтя"));
  ex.push(strength(phase, "Манжета", "Отведение плеча наружу (кабель лёжа)", "ротаторы; умеренно (на фоне игры)"));
  ex.push(core(phase, "Планка", "40-60с", "анти-экстензия; жёсткость туловища"));
  ex.push(core(phase, "Боковая планка", "40-60с/сторону", "анти-латеральная флексия"));
  return ex;
}

function buildDayC(w: number, phase: Phase): ParsedExercise[] {
  const ex: ParsedExercise[] = [warmup()];
  const e1 = explosive(phase, "Плиометрика", "Боковые запрыгивания/приземления", "5/сторону", "латеральная плио; мягкое приземление без вальгуса");
  if (e1) ex.push(e1);
  ex.push(cond(phase, "Трастеры", "12-15", "с гантелями 2×8-16кг; глубокий присед + жим без паузы"));
  ex.push(cond(phase, "Махи гирей", "15-20", "гиря 16-24кг; мощный хип-хиндж, спина нейтральна"));
  ex.push(cond(phase, "Фермерская прогулка", "30-40 м", "осанка/хват/контрлатеральность"));
  ex.push(cond(phase, "Медбол-слэм", "8-10", "взрывная ротация/вертикаль; только после разминки"));
  ex.push(cond(phase, "Бёрпи", "8-10", "кондиция всего тела"));
  ex.push(core(phase, "Планка", "40-60с", "анти-экстензия"));
  ex.push(core(phase, "Боковая планка", "40-60с/сторону", "анти-латеральная"));
  ex.push(core(phase, "Паллоф-пресс", "10-12/сторону", "антиротация"));
  ex.push(core(phase, "Русский твист", "12-15/сторону", "контролируемая ротация"));
  ex.push(cardioRun(phase));
  return ex;
}

export function buildTennisProgram(): ParsedContent {
  const weeks: ParsedWeek[] = [];
  for (let w = 1; w <= 12; w++) {
    const phase = phaseForWeek(w);
    const days: ParsedDay[] = [
      { day_name: "День 1 — Full Body (низ+верх)", day_order: 1, focus: "ЗС/квад + тяга/жим (ВП/ГП/ГЖ/ВЖ)", exercises: buildDayA(w, phase) },
      { day_name: "День 2 — Full Body (низ+верх)", day_order: 2, focus: "Ягод/привод + тяга/жим/ротаторы (ВП/ГП/ГЖ)", exercises: buildDayB(w, phase) },
      { day_name: "День 3 — Кондиция + Кор (ОФП)", day_order: 3, focus: "Трастеры/махи/фермерская/слэм/бёрпи + кор + финиш-бег", exercises: buildDayC(w, phase) },
    ];
    weeks.push({ week_number: w, week_label: WEEK_LABEL[phase], is_deload: phase === "deload", days });
  }

  return {
    program_name: "Tennis — силовая база (12 нед, 3 дня)",
    generated_at: new Date().toISOString(),
    version: 1,
    weeks,
    notes: [
      "Спорт-специфичный шаблон: теннис — ротационная мощь, латеральная стабильность, игра вне шаблона.",
      "Дни 1/2 — Full Body (низ+верх) с балансом вертикальных/горизонтальных тяг и жимов.",
      "День 3 — зальная ОФП (кондиция+кор); финиш-бег — лёгкий, клиент бегает с другим тренером на трассе.",
      "Взрывная/плиометрика — строго в начале дня, только фаза power (нед 9–11); делoad без неё.",
      "Прекауции: плиометрика только после разминки; при боли в плече — снизить объём наружной ротации.",
    ],
  };
}
