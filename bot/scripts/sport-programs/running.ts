/**
 * Running — силовая база для бегуна (12 недель, 3 дня/нед, средний уровень).
 *
 * Структура строго соответствует ParsedContent (bot/src/lib/program-utils.ts):
 *  weeks: ParsedWeek[] (week_number, week_label, is_deload, days)
 *  days: ParsedDay[] (day_name, day_order, focus, exercises)
 *  exercises: ParsedExercise[] (name, sets/reps/rest/rpe как string, notes, block;
 *            кардио — отдельный ParsedExercise с type:"cardio").
 * %ПМ и Темп упакованы в notes. Бег на трассе — вне шаблона (кардио-поля).
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
  hypertrophy: "Гипертрофия мышц НЧ",
  strength: "Сила НЧ + одноопорная",
  power: "Мощь + плиометрика + ВИИТ",
  deload: "Делoad",
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

function strength(phase: Phase, block: string, name: string, extraNote = ""): ParsedExercise {
  const p = PHASE_PRESCRIPTION[phase];
  const note = `${p.pct}, темп ${p.tempo}${extraNote ? `. ${extraNote}` : ""}`.trim();
  return { block, name, sets: p.sets, reps: p.reps, rpe: p.rpe, rest: p.rest, notes: note };
}

function warmup(): ParsedExercise {
  return {
    block: "Разминка",
    name: "Разминка: динамика + мобильность ТБС/голеностоп + активация ягодиц",
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
      notes: "аэробная база; без спринтов",
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
  ex.push(strength(phase, "Сила", "Румынская тяга с гантелями", "ЗС; нейтраль позвоночника"));
  ex.push(strength(phase, "Сила", "Ягодичный мостик с гантелью", "УС; пик в укороченном состоянии"));
  ex.push(strength(phase, "Сила", "Односторонняя румынская тяга", "одноопорная ЗЦ; таз без ротации"));
  ex.push(strength(phase, "Сила", "Нордические наклоны", "эксцентрика 3-4 с; страховка партнёром"));
  ex.push(strength(phase, "Сила", "Подъём на носки (икры)", "полная амплитуда"));
  return ex;
}

function buildDayB(w: number, phase: Phase): ParsedExercise[] {
  const ex: ParsedExercise[] = [warmup()];
  ex.push(strength(phase, "Сила", "Приседания со штангой", "квад/ягод; техника важнее веса"));
  ex.push(strength(phase, "Сила", "Болгарские выпады", "одностороннее квад/ягод"));
  ex.push(strength(phase, "Сила", "Степ-ап с гантелями", "толчковая нога ведёт"));
  ex.push(strength(phase, "Стабильность", "Ракушка (clamshell)", "glute med; без ротации таза"));
  ex.push(strength(phase, "Профилактика", "Подъём носка на себя (передняя большеберцовая)", "без веса; высокие повторы"));
  return ex;
}

function buildDayC(w: number, phase: Phase): ParsedExercise[] {
  const ex: ParsedExercise[] = [warmup()];
  ex.push(strength(phase, "Кондиция", "Толкание саней", "силовая выносливость; без паузы"));
  ex.push(strength(phase, "Кор", "Планка", "анти-экстензия; жёсткость туловища"));
  ex.push(strength(phase, "Кор", "Русский твист", "контролируемая ротация"));
  ex.push(strength(phase, "Кор", "Bird-dog", "стабильность поясницы"));
  ex.push(strength(phase, "Постурал", "Боковые подъёмы гантелей", "против округлых плеч (беговая осанка)"));
  if (phase === "power") {
    ex.push(strength(phase, "Плиометрика", "Запрыгивания на тумбу", "мягкое приземление; только после разминки"));
    ex.push(strength(phase, "Плиометрика", "Боковые запрыгивания/приземления", "латеральная плио; без вальгуса"));
  }
  ex.push(cardioRun(phase));
  return ex;
}

export function buildRunningProgram(): ParsedContent {
  const weeks: ParsedWeek[] = [];
  for (let w = 1; w <= 12; w++) {
    const phase = phaseForWeek(w);
    const days: ParsedDay[] = [
      { day_name: "День A — задняя цепь + одностороннее", day_order: 1, focus: "Ягодицы / бицепс бедра / икра", exercises: buildDayA(w, phase) },
      { day_name: "День B — квадрицепс + стабильность таза", day_order: 2, focus: "Квад / glute med / передняя большеберцовая", exercises: buildDayB(w, phase) },
      { day_name: "День C — мощь + кор + аэроб", day_order: 3, focus: "Плиометрика / кор / бег", exercises: buildDayC(w, phase) },
    ];
    weeks.push({ week_number: w, week_label: WEEK_LABEL[phase], is_deload: phase === "deload", days });
  }

  return {
    program_name: "Running — силовая база (12 нед, 3 дня)",
    generated_at: new Date().toISOString(),
    version: 1,
    weeks,
    notes: [
      "Спорт-специфичный шаблон: бег — одноопорное, повторяющееся движение с высокой нагрузкой на НЧ.",
      "Регионы: задняя цепь (ягод/бицепс бедра), квадрицепс, икра, передняя большеберцовая, glute med/min, голеностоп, кор.",
      "Блоки: 1) разминка/активация, 2) задняя/передняя цепь, 3) односторонняя устойчивость, 4) кор+осанка, 5) плиометрика (Фаза 3+)+аэроб, 6) заминка.",
      "Бег на трассе — вне шаблона. %ПМ и темп упакованы в notes каждого упражнения.",
      "Прекауции: плиометрика только после базы и разминки; передняя большеберцовая — без веса; при боли в колене/ахилле — снизить объём одностороннего и плио.",
    ],
  };
}
