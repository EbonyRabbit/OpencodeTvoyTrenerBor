/**
 * Triathlon — силовая база (12 недель, 3 дня/нед, средний уровень).
 *
 * Структура строго соответствует ParsedContent (bot/src/lib/program-utils.ts).
 * %ПМ и Темп в notes; кардио — ParsedExercise с type:"cardio".
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
  hypertrophy: "Гипертрофия (плечо/НЧ)",
  strength: "Сила + одноопорная",
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
    name: "Разминка: мобильность плеча + ТБС + активация ягодиц",
  };
}

function cardioBike(phase: Phase): ParsedExercise {
  if (phase === "deload") {
    return {
      block: "Кондиция",
      name: "Велосипед",
      type: "cardio",
      duration: "30-40 мин",
      pace: "Зона 2",
      heart_rate: "Z2",
      notes: "восстановительная езда",
    };
  }
  if (phase === "power") {
    return {
      block: "Кондиция",
      name: "Велосипед",
      type: "cardio",
      duration: "Интервалы 4×(4 мин Z4 / 3 мин Z1)",
      heart_rate: "Z4",
      notes: "ВИИТ на велике",
    };
  }
  return {
    block: "Кондиция",
    name: "Велосипед",
    type: "cardio",
    duration: "60-90 мин",
    pace: "Зона 2",
    heart_rate: "Z2",
    notes: "объёмная езда",
  };
}

function buildDayA(w: number, phase: Phase): ParsedExercise[] {
  const ex: ParsedExercise[] = [warmup()];
  ex.push(strength(phase, "Сила", "Румынская тяга с гантелями", "ЗС; нейтраль позвоночника"));
  ex.push(strength(phase, "Сила", "Приседания со штангой", "квад/ягод"));
  ex.push(strength(phase, "Сила", "Односторонняя румынская тяга", "одноопорная ЗЦ"));
  ex.push(strength(phase, "Сила", "Болгарские выпады", "одностороннее"));
  ex.push(strength(phase, "Сила", "Подъём на носки (икры)", "полная амплитуда"));
  ex.push(strength(phase, "Кор", "Планка", "анти-экстензия"));
  return ex;
}

function buildDayB(w: number, phase: Phase): ParsedExercise[] {
  const ex: ParsedExercise[] = [warmup()];
  ex.push(strength(phase, "Тяга", "Тяга верхнего блока", "широчайшие; против сутулости от езды"));
  ex.push(strength(phase, "Манжета", "Тяга к лицу", "задняя дельта/трапеция — здоровье плеча"));
  ex.push(strength(phase, "Манжета", "Отведение плеча наружу (кабель лёжа)", "ротаторы; умеренно (на фоне плавания)"));
  ex.push(strength(phase, "Жим", "Жим гантелей на наклонной", "грудь/дельты"));
  ex.push(strength(phase, "Тяга", "Подтягивания", "при необходимости — гравитрон"));
  ex.push(strength(phase, "Кор", "Русский твист", "ротация туловища"));
  return ex;
}

function buildDayC(w: number, phase: Phase): ParsedExercise[] {
  const ex: ParsedExercise[] = [warmup()];
  ex.push(strength(phase, "Кондиция", "Толкание саней", "силовая выносливость"));
  ex.push(strength(phase, "Стабильность", "Степ-ап с гантелями", "одностороннее"));
  ex.push(strength(phase, "Стабильность", "Ракушка (clamshell)", "glute med"));
  ex.push(strength(phase, "Кор", "Bird-dog", "стабильность поясницы"));
  if (phase === "power") {
    ex.push(strength(phase, "Плиометрика", "Запрыгивания на тумбу", "мягкое приземление; только после разминки"));
    ex.push(strength(phase, "Плиометрика", "Боковые запрыгивания/приземления", "латеральная плио; без вальгуса"));
  }
  ex.push(cardioBike(phase));
  return ex;
}

export function buildTriathlonProgram(): ParsedContent {
  const weeks: ParsedWeek[] = [];
  for (let w = 1; w <= 12; w++) {
    const phase = phaseForWeek(w);
    const days: ParsedDay[] = [
      { day_name: "День A — нижняя цепь + одностороннее", day_order: 1, focus: "Задняя/передняя цепь, одноопорная сила", exercises: buildDayA(w, phase) },
      { day_name: "День B — верх (плечо/манжета/широчайшие)", day_order: 2, focus: "Здоровье плеча, тяга, кор", exercises: buildDayB(w, phase) },
      { day_name: "День C — гибрид + плио + кардио", day_order: 3, focus: "Перенос силы, плиометрика, велик", exercises: buildDayC(w, phase) },
    ];
    weeks.push({ week_number: w, week_label: WEEK_LABEL[phase], is_deload: phase === "deload", days });
  }

  return {
    program_name: "Triathlon — силовая база (12 нед, 3 дня)",
    generated_at: new Date().toISOString(),
    version: 1,
    weeks,
    notes: [
      "Спорт-специфичный шаблон: триатлон совмещает плавание/велик/бег.",
      "Регионы: плечо/манжета, широчайшие, задняя/передняя цепь НЧ, glute med, кор, голеностоп.",
      "Блоки: 1) разминка/мобильность, 2) основной силовой блок, 3) односторонняя устойчивость, 4) кор+манжета/задняя дельта, 5) плиометрика (Фаза 3+)+кардио, 6) заминка.",
      "Плавание/велик/бег — вне шаблона. %ПМ и темп упакованы в notes.",
      "Прекауции: не дублировать объём плеча с плаванием (умеренная манжета); плиометрика только после разминки.",
    ],
  };
}
