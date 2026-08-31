/**
 * Seed: Running - силовая база для бегуна (12 недель, 3 дня/нед, средний уровень).
 *
 * Идемпотентно: программа по названию, упражнения по name_key (без дублей).
 *
 * Run from bot/:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/seed-running-program.ts
 */
import "dotenv/config";
import { supabaseAdmin } from "../src/lib/supabase-admin.js";
import { getParsedContent } from "../src/lib/program-utils.js";
import { normalizeExerciseName } from "../src/lib/exercise-library.js";
import type { Json } from "../src/lib/types.js";
import { buildRunningProgram } from "./sport-programs/running.js";

const PROGRAM_TITLE = "Running - силовая база (12 нед, 3 дня)";
const DESCRIPTION =
  "Спорт-специфичный шаблон для бегуна среднего уровня: 3 силовых дня в неделю. " +
  "Блоки: задняя цепь/одностороннее → квад/стабильность таза → мощь+плио+кор+аэроб. " +
  "Фазы: база - гипертрофия - сила - мощь+ВИИТ - разгрузка. Бег на трассе - вне шаблона.";
const EQUIPMENT = "Зал: штанга, гантели, гиря 16-24кг, тумба, резинка, медбол";

type NewExercise = {
  name: string;
  aliases: string[];
  descriptionRu: string;
  techniqueRu: string;
  featuresRu: string[];
  muscleGroup: string | null;
  equipment: string | null;
  difficulty: string | null;
  contraindications: string | null;
};

const NEW_EXERCISES: NewExercise[] = [
  {
    name: "Односторонняя румынская тяга",
    aliases: ["single leg RDL", "одноногая румынка"],
    descriptionRu: "Румынская тяга на одной ноге - задняя цепь и баланс.",
    techniqueRu: "Опора на одну ногу, наклон с прямой спиной, лёгкий вес, таз без ротации. Контроль.",
    featuresRu: ["задняя цепь", "односторонняя сила", "баланс"],
    muscleGroup: "Ягодицы/ЗЦ",
    equipment: "Гантель",
    difficulty: "intermediate",
    contraindications: null,
  },
  {
    name: "Ракушка (clamshell)",
    aliases: ["clamshell", "ракушка"],
    descriptionRu: "Отведение бедра лёжа на боку для glute med.",
    techniqueRu: "Лёжа на боку, колени согнуты, медленное открытие верхнего колена вверх без ротации таза.",
    featuresRu: ["glute med", "латеральная стабильность", "колено бегуна"],
    muscleGroup: "Ягодицы",
    equipment: "Резинка/без инвентаря",
    difficulty: "beginner",
    contraindications: null,
  },
  {
    name: "Подъём носка на себя (передняя большеберцовая)",
    aliases: ["tibial raise", "передняя большеберцовая"],
    descriptionRu: "Подъём носка на себя для передней большеберцовой мышцы.",
    techniqueRu: "Сидя/стоя, медленный подъём носка вверх, без веса. Высокие повторы.",
    featuresRu: ["передняя большеберцовая", "профилактика шина", "голеностоп"],
    muscleGroup: "Голень",
    equipment: "Без инвентаря",
    difficulty: "beginner",
    contraindications: null,
  },
  {
    name: "Подъем на носки (икры)",
    aliases: ["calf raise", "икры", "Подъём на носки (икры)"],
    descriptionRu: "Подъем на носки - сила и выносливость икр и ахилла для отталкивания и профилактики травм у бегуна.",
    techniqueRu: "Стоя на ступени/платформе: полная амплитуда - медленное опускание (2 сек) ниже опоры, пауза 1 сек, мощный подъем. Прямое колено - акцент на икроножную, согнутое - на камбаловидную (важно для бегуна). Держать таз нейтрально, без раскачки.",
    featuresRu: ["ахилл и икры", "отталкивание и экономичность", "профилактика тендинопатии"],
    muscleGroup: "Икры",
    equipment: "Свободный вес",
    difficulty: "beginner",
    contraindications: null,
  },
  {
    name: "Отведение бедра (кабель/резинка)",
    aliases: ["abduction hip", "отведение ягодицы"],
    descriptionRu: "Изолирующее отведение бедра в сторону для glute med/min.",
    techniqueRu: "Стоя боком к кабелю/резинке, лёгкое отведение рабочей ноги в сторону без наклона туловища.",
    featuresRu: ["латеральная стабильность", "glute med/min", "профилактика вальгуса"],
    muscleGroup: "Ягодицы",
    equipment: "Кабель/резинка",
    difficulty: "beginner",
    contraindications: null,
  },
  {
    name: "Эксцентрика инверсии голеностопа",
    aliases: ["inversion ecc", "инверсия голеностопа"],
    descriptionRu: "Контролируемое опускание стопы в инверсию для профилактики растяжений.",
    techniqueRu: "Медленное (3-4 с) опускание стопы внутрь под контролем; без веса в начале.",
    featuresRu: ["голеностоп", "профилактика травм", "стабильность"],
    muscleGroup: "Голеностоп",
    equipment: "Без инвентаря/резинка",
    difficulty: "beginner",
    contraindications: "При боли в голеностопе - стоп.",
  },
  {
    name: "Боковые запрыгивания/приземления",
    aliases: ["lateral bound", "боковые прыжки"],
    descriptionRu: "Латеральные прыжки с мягким приземлением - плиометрика.",
    techniqueRu: "Прыжок в сторону с мягким приземлением на опорную ногу, без вальгуса колена.",
    featuresRu: ["плиометрика", "латеральная мощь", "приземление"],
    muscleGroup: "НК/стабильность",
    equipment: "Тумба",
    difficulty: "intermediate",
    contraindications: "Только после блока стабильности; при боли в колене/ахилле - стоп.",
  },
  {
    name: "Медбол-слэм",
    aliases: ["medicine ball slam", "слэм"],
    descriptionRu: "Бросок медбола в пол - взрывная вертикальная/ротационная работа.",
    techniqueRu: "Подъём медбола над головой и бросок в пол с усилием всего тела. Только после разминки.",
    featuresRu: ["взрывная сила", "кор", "кондиция"],
    muscleGroup: "Кор/НК",
    equipment: "Медбол",
    difficulty: "beginner",
    contraindications: "Только после разминки; при боли в пояснице - стоп.",
  },
  {
    name: "Барьерные выпрыгивания",
    aliases: ["hurdle hop", "барьерный прыжок", "bounding"],
    descriptionRu: "Серийные прыжки через барьеры - горизонтальная плиометрика (bounding).",
    techniqueRu: "Мягкое приземление и быстрый отскок через барьеры. Только после разминки.",
    featuresRu: ["плиометрика", "горизонтальная мощь", "приземление"],
    muscleGroup: "НК",
    equipment: "Барьеры",
    difficulty: "intermediate",
    contraindications: "Только после разминки; при боли в колене/ахилле - стоп.",
  },
  {
    name: "Dead bug",
    aliases: ["мёртвый жук", "deadbug"],
    descriptionRu: "Лёжа на спине, противофазные движения рук/ног - анти-экстензия кор.",
    techniqueRu: "Поясница прижата к полу, медленные движения конечностями без отрыва поясницы.",
    featuresRu: ["анти-экстензия", "стабильность поясницы", "кор"],
    muscleGroup: "Кор",
    equipment: "Без инвентаря",
    difficulty: "beginner",
    contraindications: null,
  },
  {
    name: "Паллоф-пресс",
    aliases: ["pallof press", "антиротация кор"],
    descriptionRu: "Жим троса от груди с сохранением нейтрального туловища - антиротация кор.",
    techniqueRu: "Стоя боком к тросу, жим от груди вперёд с удержанием таза/плеч без поворота. Медленно.",
    featuresRu: ["антиротация", "кор", "защита поясницы"],
    muscleGroup: "Кор",
    equipment: "Резинка/трос",
    difficulty: "beginner",
    contraindications: null,
  },
  {
    name: "Отжимания на брусьях",
    aliases: ["dips", "брусья", "отжимания на брусьях"],
    descriptionRu: "Отжимания на брусьях - грудные, трицепс и передняя дельта, сила вертикального жима для бегуна.",
    techniqueRu: "Хват на брусьях, корпус без раскачки, опускание до 90 градусов в локте, мощный подъем. Локти назад, не в стороны. При боли в плече/грудине - заменить на отжимания.",
    featuresRu: ["грудные", "трицепс", "вертикальный жим"],
    muscleGroup: "Грудь/Трицепс",
    equipment: "Брусья",
    difficulty: "intermediate",
    contraindications: "При боли в плече/грудине или нестабильности плеча - заменить на отжимания.",
  },
  {
    name: "Планка Копенгагена",
    aliases: ["copenhagen plank", "копенгаген", "копенгаген планка"],
    descriptionRu: "Боковая планка с опорой верхней ноги на скамью - приводящие + кор для стабильности таза у бегуна.",
    techniqueRu: "Боковая планка, верхняя голень на скамье 30-45 см, нижняя нога поднята к верхней, таз в линии без провиса. Держать 20-40 сек/сторону.",
    featuresRu: ["приводящие", "стабильность таза", "профилактика паха"],
    muscleGroup: "Кор/Приводящие",
    equipment: "Скамья",
    difficulty: "intermediate",
    contraindications: "При боли в паху/колене - снизить время или заменить на боковую планку.",
  },
  {
    name: "Запрыгивания на тумбу",
    aliases: ["box jump", "запрыгивание"],
    descriptionRu: "Вертикальное запрыгивание на тумбу - взрывная плиометрика.",
    techniqueRu: "Взрывной прыжок вверх с мягким приземлением на тумбу, без удара пятками. Только после разминки.",
    featuresRu: ["плиометрика", "взрывная сила", "приземление"],
    muscleGroup: "НК",
    equipment: "Тумба",
    difficulty: "intermediate",
    contraindications: "Только после разминки; при боли в колене/ахилле - стоп.",
  },
];

async function upsertExercises(): Promise<void> {
  for (const ex of NEW_EXERCISES) {
    const nameKey = normalizeExerciseName(ex.name);
    const { data: existing } = await supabaseAdmin
      .from("exercises")
      .select("id, name_key")
      .eq("name_key", nameKey)
      .maybeSingle();

    if (existing) {
      console.log(`  упражнение уже есть: ${ex.name}`);
      continue;
    }

    const { error } = await supabaseAdmin.from("exercises").insert({
      name: ex.name,
      name_key: nameKey,
      aliases: ex.aliases,
      description_ru: ex.descriptionRu,
      description_en: null,
      technique_ru: ex.techniqueRu,
      technique_en: null,
      features_ru: ex.featuresRu,
      features_en: [],
      video_url: null,
      muscle_group: ex.muscleGroup,
      equipment: ex.equipment,
      difficulty: ex.difficulty,
      contraindications: ex.contraindications,
    });
    if (error) {
      if (error.code === "23505") {
        console.warn(`  ${ex.name}: race на name_key - skip`);
      } else {
        console.error(`  ${ex.name}: ошибка вставки - ${error.message}`);
      }
      continue;
    }
    console.log(`  + упражнение: ${ex.name}`);
  }
}

async function main(): Promise<void> {
  const content = buildRunningProgram();
  const parsed = getParsedContent(content as unknown as Json);
  if (!parsed) {
    console.error("ОШИБКА: содержимое программы не прошло валидацию");
    process.exit(1);
  }

  const totalDays = (content.weeks ?? []).reduce((a, w) => a + (w.days?.length ?? 0), 0);
  const totalExercises = (content.weeks ?? []).reduce(
    (a, w) => a + (w.days ?? []).reduce((d, day) => d + (day.exercises?.length ?? 0), 0),
    0,
  );
  console.log(`Программа: ${PROGRAM_TITLE}`);
  console.log(`Недель: ${content.weeks?.length}, дней: ${totalDays}, упражнений/нед: ${totalExercises}`);

  console.log("Новые упражнения:");
  await upsertExercises();

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
        sport: "running",
        language: "ru",
        active: true,
        parsed_content: content as unknown as Json,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) {
      console.error("ОШИБКА обновления программы:", error.message);
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
        sport: "running",
        language: "ru",
        duration_weeks: 12,
        template_file_url: null,
        parsed_content: content as unknown as Json,
      })
      .select("id")
      .single();
    if (error) {
      console.error("ОШИБКА вставки программы:", error.message);
      process.exit(1);
    }
    console.log(`Создана программа: ${data?.id}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
