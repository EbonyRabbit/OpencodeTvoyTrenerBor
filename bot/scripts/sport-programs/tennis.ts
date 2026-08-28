/**
 * Tennis — sport-specific strength template (12 недель, 3 дня, средний уровень).
 *
 * Построен по методике «Анализ потребностей → Макро-блоки → Микро»:
 * регионы/задачи и блоки — стабильная основа (см. tennis.md), конкретный
 * состав упражнений может меняться тренером без затрагивания основы.
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

function warmup(): ParsedExercise {
  return {
    block: "Разминка",
    name: "Разминка: динамика + мобильность ТБС/плеча + активация ягодиц",
  };
}

function buildDayA(w: number, phase: Phase): ParsedExercise[] {
  const ex: ParsedExercise[] = [warmup()];
  ex.push(strength(phase, "Сила", "Румынская тяга с гантелями", "ЗС; нейтраль позвоночника, без округления"));
  ex.push(strength(phase, "Сила", "Ягодичный мост со штангой", "УС; пик в укороченном состоянии"));
  ex.push(
    strength(phase, "Сила", "Отведение бедра (кабель/резинка)", "дропсет; glute med/min для латеральной стабильности"),
  );
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
  ex.push(strength(phase, "Сила", "Болгарские выпады", "ЖГ, свободный ЛГС; одноопорная сила"));
  ex.push(strength(phase, "Сила", "Приведение бедра", "декомпрессор при латеральном торможении"));
  ex.push({
    block: "Сила",
    name: "Подъём на носки (икры)",
    sets: PHASE_PRESCRIPTION[phase].sets,
    reps: "12-15",
    rpe: "6-7",
    rest: "60с",
    notes: "икры — отталкивание; эксцентрика инверсии осторожно, без боли",
  });
  if (phase === "power") {
    ex.push({
      block: "Ротация",
      name: "Кабель-ротация туловища",
      sets: "3",
      reps: "8/сторону",
      rpe: "7",
      rest: "90с",
      notes: "взрывная X-factor; контроль, без рывков поясницей",
    });
    ex.push({
      block: "Плиометрика",
      name: "Запрыгивания на тумбу",
      sets: "3",
      reps: "5",
      rpe: "7",
      rest: "90с",
      notes: "мягкое приземление; только после стабильности",
    });
  }
  return ex;
}

function buildDayB(w: number, phase: Phase): ParsedExercise[] {
  const ex: ParsedExercise[] = [warmup()];
  ex.push(strength(phase, "Сила", "Тяга верхнего блока", "тяговая фаза удара, противовес сутулости"));
  ex.push({
    block: "Ротация",
    name: "Ротации с резинкой",
    sets: "3",
    reps: "12-15",
    rpe: "7",
    rest: "60с",
    notes: "наружные ротаторы (ER) — торможение руки после удара; ER ДО жима",
  });
  ex.push({
    block: "Ротация",
    name: "Отведение плеча наружу (кабель лёжа)",
    sets: "3",
    reps: "12-15",
    rpe: "7",
    rest: "60с",
    notes: "изолированная сила ER под нагрузкой; контроль объёма",
  });
  ex.push(strength(phase, "Сила", "Жим гантелей на наклонной", "объём жима ≤ тяги+ER"));
  ex.push(strength(phase, "Сила", "Молотки с гантелями", "предплечье/хват — буферизация локтя"));
  ex.push(strength(phase, "Сила", "Тяга к лицу", "задняя дельта/трапеция — здоровье плеча"));
  if (phase === "power") {
    ex.push({
      block: "Ротация",
      name: "Ротационный бросок медбола",
      sets: "3",
      reps: "8/сторону",
      rpe: "7",
      rest: "90с",
      notes: "взрывная ротационная мощь удара; только после разминки",
    });
  }
  return ex;
}

function buildDayC(w: number, phase: Phase): ParsedExercise[] {
  const ex: ParsedExercise[] = [warmup()];
  ex.push({
    block: "Кондиция",
    name: "Тяга саней",
    sets: phase === "deload" ? "2" : "3",
    reps: "30 м",
    rpe: "7",
    rest: "90с",
    notes: "кор + сгибатели бедра; брейсинг",
  });
  ex.push({
    block: "Кор",
    name: "Планка",
    sets: "3",
    reps: "40-60с",
    rpe: "7",
    rest: "60с",
    notes: "анти-экстензия; жёсткость туловища",
  });
  ex.push({
    block: "Кор",
    name: "Боковая планка",
    sets: "3",
    reps: "40-60с/сторону",
    rpe: "7",
    rest: "60с",
    notes: "анти-латеральная флексия",
  });
  ex.push({
    block: "Кор",
    name: "Паллоф-пресс",
    sets: "3",
    reps: "12-15/сторону",
    rpe: "7",
    rest: "60с",
    notes: "антиротация кор — защита поясницы при ударе",
  });
  ex.push(cardioRun(phase));
  ex.push(strength(phase, "Сила", "Приведение бедра", "повторная силовая выносливость"));
  if (phase === "power") {
    ex.push({
      block: "Плиометрика",
      name: "Боковые запрыгивания/приземления",
      sets: "3",
      reps: "5/сторону",
      rpe: "7",
      rest: "90с",
      notes: "латеральная плиометрика; мягкое приземление без вальгуса",
    });
  }
  return ex;
}

function cardioRun(phase: Phase): ParsedExercise {
  if (phase === "foundation" || phase === "deload") {
    return {
      block: "Кондиция",
      name: "Бег",
      type: "cardio",
      duration: "20-30 мин",
      pace: "Z2 (легко)",
      heart_rate: "60-70% ЧССmax",
      notes: "восстановительная З2; база аэробной выносливости перед ВИИТ",
    };
  }
  if (phase === "power") {
    return {
      block: "Кондиция",
      name: "Бег",
      type: "cardio",
      duration: "10×(20с спринт / 40с ходьба)",
      pace: "Z4",
      heart_rate: "85-90% ЧССmax",
      notes: "ВИИТ: работа:отдых 1:2; потолок 90% ЧССmax; базу Z2 набрать заранее",
    };
  }
  return {
    block: "Кондиция",
    name: "Бег",
    type: "cardio",
    duration: "8×(20с спринт / 40с ходьба)",
    pace: "Z4",
    heart_rate: "80-85% ЧССmax",
    notes: "ВИИТ интервалы под плотность очков 1:3-1:5",
  };
}

export function buildTennisProgram(): ParsedContent {
  const weeks: ParsedWeek[] = [];
  for (let w = 1; w <= 12; w++) {
    const phase = phaseForWeek(w);
    const days: ParsedDay[] = [
      {
        day_name: "День A — Низ",
        day_order: 1,
        focus: "Ягодицы / задняя цепь / ротация бедра",
        exercises: buildDayA(w, phase),
      },
      {
        day_name: "День B — Верх + ротаторы",
        day_order: 2,
        focus: "Плечо / ротаторы / предплечье",
        exercises: buildDayB(w, phase),
      },
      {
        day_name: "День C — Кондиция + Кор",
        day_order: 3,
        focus: "ВИИТ / кор / приведение",
        exercises: buildDayC(w, phase),
      },
    ];
    weeks.push({
      week_number: w,
      week_label: WEEK_LABEL[phase],
      is_deload: phase === "deload",
      days,
    });
  }

  return {
    program_name: "Теннис — силовая база (12 нед, 3 дня)",
    generated_at: new Date().toISOString(),
    version: 1,
    weeks,
    notes: [
      "Спорт-специфичный шаблон: теннис — прерывистый, многонаправленный, ротационный вид.",
      "Регионы: ягодицы (РС+УС), задняя цепь, квадрицепс, приводящие, отводящие/ротаторы бедра, плечо+манжета+задняя дельта, предплечье/хват, кор (вкл. антиротацию), икры/голеностоп.",
      "Блоки: 1) мобильность/стабильность, 2) низ гипертрофия+сила/кор, 3) ГСС/ротаторы/ПЛК, 4) ротация плеч+бёдер, 5) ВИИТ/кондиция, 6) навыки (гашение/плио после стабильности).",
      "Игра на корте — вне шаблона. %ПМ и темп упакованы в notes каждого упражнения.",
      "Прекауции: нейтраль позвоночника в РС; ER до жима и контроль объёма; инверсия голеностопа без боли; плиометрика только после стабильности.",
    ],
  };
}
