/**
 * Swimming — силовая база (12 недель, 3 дня/нед, средний уровень).
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
  foundation: "База: здоровье плеча + техника",
  hypertrophy: "Гипертрофия (тяга/манжета)",
  strength: "Сила тяги + ротация",
  power: "Сила + объём (спец. подготовка)",
  deload: "Делoad",
};

const PHASE_PRESCRIPTION: Record<
  Phase,
  { sets: string; reps: string; rpe: string; pct: string; tempo: string; rest: string }
> = {
  foundation: { sets: "2-3", reps: "12-15", rpe: "6-7", pct: "%ПМ 60-65", tempo: "21X1", rest: "60-90с" },
  hypertrophy: { sets: "3", reps: "10-12", rpe: "7-8", pct: "%ПМ 67-72", tempo: "21X1", rest: "75-90с" },
  strength: { sets: "4", reps: "6-10", rpe: "8", pct: "%ПМ 75-82", tempo: "21X1", rest: "90-120с" },
  power: { sets: "4", reps: "5-8", rpe: "8-9", pct: "%ПМ 78-85", tempo: "X0X1", rest: "120с" },
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
    name: "Разминка: мобильность плеча + грудного отдела + активация манжеты",
  };
}

function cardioSwim(phase: Phase): ParsedExercise {
  if (phase === "deload") {
    return {
      block: "Кондиция",
      name: "Плавание",
      type: "cardio",
      distance: "1500-2000 м",
      duration: "техника Z2",
      heart_rate: "Z2",
      notes: "лёгкое техническое плавание",
    };
  }
  return {
    block: "Кондиция",
    name: "Плавание",
    type: "cardio",
    distance: "2500-3500 м",
    duration: "включая интервалы",
    heart_rate: "Z2-Z4",
    notes: "гребок вне шаблона; интервалы по плану тренера",
  };
}

function buildDayA(w: number, phase: Phase): ParsedExercise[] {
  const ex: ParsedExercise[] = [warmup()];
  ex.push(strength(phase, "Тяга", "Тяга верхнего блока", "широчайшие; сила гребка"));
  ex.push(strength(phase, "Тяга", "Подтягивания", "при необходимости — гравитрон"));
  ex.push(strength(phase, "Манжета", "Отведение плеча наружу (кабель лёжа)", "ротаторы; умеренно (на фоне плавания)"));
  ex.push(strength(phase, "Трицепс", "Разгибание руки с гантелью из-за головы", "толчок/пронос"));
  ex.push(strength(phase, "Стабильность", "Лопаточный отжим (scapular push-up)", "стабильность лопатки"));
  ex.push(strength(phase, "Кор", "Русский твист", "ротация туловища"));
  return ex;
}

function buildDayB(w: number, phase: Phase): ParsedExercise[] {
  const ex: ParsedExercise[] = [warmup()];
  ex.push(strength(phase, "Сила", "Румынская тяга с гантелями", "ЗС; нейтраль позвоночника"));
  ex.push(strength(phase, "Ноги", "Подъём ног в висе", "сгибатели бедра (кик)"));
  ex.push(strength(phase, "Кор", "Планка", "анти-экстензия"));
  ex.push(strength(phase, "Кор", "Обратные скручивания", "нижний кор"));
  ex.push(strength(phase, "Голеностоп", "Подъём носка на себя (передняя большеберцовая)", "без веса; стопа как лопатка (кик)"));
  return ex;
}

function buildDayC(w: number, phase: Phase): ParsedExercise[] {
  const ex: ParsedExercise[] = [warmup()];
  ex.push(strength(phase, "Манжета", "Тяга к лицу", "задняя дельта/трапеция"));
  ex.push(strength(phase, "Постурал", "Отведение плеча назад", "против сутулости"));
  ex.push(strength(phase, "Постурал", "Разведение рук с резинкой", "задняя дельта"));
  ex.push(strength(phase, "Тяга", "Тяга гантелей к поясу", "широчайшие"));
  ex.push(strength(phase, "Кор", "Планка на прямых руках", "стабильность туловища"));
  ex.push(cardioSwim(phase));
  return ex;
}

export function buildSwimmingProgram(): ParsedContent {
  const weeks: ParsedWeek[] = [];
  for (let w = 1; w <= 12; w++) {
    const phase = phaseForWeek(w);
    const days: ParsedDay[] = [
      { day_name: "День A — плечо/манжета + тяга", day_order: 1, focus: "Здоровье плеча, широчайшие, трицепс", exercises: buildDayA(w, phase) },
      { day_name: "День B — кор/ротация + ноги", day_order: 2, focus: "Ротация, работа ног (кик), голеностоп", exercises: buildDayB(w, phase) },
      { day_name: "День C — стабильность плеча + кардио", day_order: 3, focus: "Постурал, кор, плавание", exercises: buildDayC(w, phase) },
    ];
    weeks.push({ week_number: w, week_label: WEEK_LABEL[phase], is_deload: phase === "deload", days });
  }

  return {
    program_name: "Swimming — силовая база (12 нед, 3 дня)",
    generated_at: new Date().toISOString(),
    version: 1,
    weeks,
    notes: [
      "Спорт-специфичный шаблон: плавание — объёмный гребок, ротация, работа ног.",
      "Регионы: плечо/манжета (приоритет), широчайшие, трицепс, кор (ротация), сгибатели бедра, голеностоп.",
      "Блоки: 1) разминка/мобильность плеча, 2) манжета/лопатка, 3) тяга/трицепс, 4) кор/ротация, 5) сгибатели бедра/голеностоп, 6) кардио (плавание).",
      "Плавание — вне шаблона. %ПМ и темп упакованы в notes.",
      "Прекауции: умеренная манжета (большой объём гребка); при передней боли в плече — снизить объём наружной ротации.",
    ],
  };
}
