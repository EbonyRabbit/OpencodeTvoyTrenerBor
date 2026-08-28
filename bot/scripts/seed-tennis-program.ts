/**
 * Seed: Теннис — силовая база (12 недель, 3 дня/нед, средний уровень).
 *
 * Идемпотентно:
 *  - программа ищется по названию и обновляется (или создаётся);
 *  - новые спорт-специфичные упражнения вставляются по name_key (без дублей).
 *
 * Run from bot/:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/seed-tennis-program.ts
 */
import "dotenv/config";
import { supabaseAdmin } from "../src/lib/supabase-admin.js";
import { getParsedContent } from "../src/lib/program-utils.js";
import { normalizeExerciseName } from "../src/lib/exercise-library.js";
import type { Json } from "../src/lib/types.js";
import { buildTennisProgram } from "./sport-programs/tennis.js";

const PROGRAM_TITLE = "Теннис — силовая база (12 нед, 3 дня)";
const DESCRIPTION =
  "Спорт-специфичный шаблон для теннисиста среднего уровня: 3 силовых дня в неделю. " +
  "Блоки: мобильность/стабильность → гипертрофия+сила низ/верх → ротаторы/предплечье → " +
  "ротация плеч/бёдер → ВИИТ/кондиция → навыки (приземление/плиометрика). " +
  "Фазы: база → гипертрофия → сила → мощь+ВИИТ → делoad. Игра на корте — вне шаблона.";
const EQUIPMENT =
  "Зал: штанга, гантели, кабель/резинка, тумба, сани, медбол, скамья";

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
    name: "Отведение бедра (кабель/резинка)",
    aliases: ["abduction hip", "отведение ягодицы"],
    descriptionRu: "Изолирующее отведение бедра в сторону для glute med/min.",
    techniqueRu: "Стоя боком к кабелю/резинке, лёгкое отведение рабочей ноги в сторону без наклона туловища. Таз стабилен.",
    featuresRu: ["латеральная стабильность", "glute med/min", "профилактика вальгуса"],
    muscleGroup: "Ягодицы",
    equipment: "Кабель/резинка",
    difficulty: "beginner",
    contraindications: null,
  },
  {
    name: "Приведение бедра",
    aliases: ["adduction hip", "приводящие"],
    descriptionRu: "Приведение бедра к опоре для приводящих мышц.",
    techniqueRu: "Стоя у тренажёра/резинки, медленное сведение рабочей ноги к опорной. Контроль без рывка.",
    featuresRu: ["приводящие", "латеральное торможение", "стабильность"],
    muscleGroup: "Приводящие",
    equipment: "Тренажёр/резинка",
    difficulty: "beginner",
    contraindications: null,
  },
  {
    name: "Подъём на носки (икры)",
    aliases: ["calf raise", "икры"],
    descriptionRu: "Подъём на носки для икроножных и камбаловидной.",
    techniqueRu: "Полная амплитуда: растяжение внизу, пик сокращения вверху. Можно с весом.",
    featuresRu: ["икры", "отталкивание", "голеностоп"],
    muscleGroup: "Икры",
    equipment: "Свободный вес",
    difficulty: "beginner",
    contraindications: null,
  },
  {
    name: "Эксцентрика инверсии голеностопа",
    aliases: ["inversion ecc", "инверсия голеностопа"],
    descriptionRu: "Контролируемое опускание стопы в инверсию для профилактики растяжений.",
    techniqueRu: "Медленное (3-4 с) опускание стопы внутрь под контролем; без веса в начале. Только при отсутствии боли.",
    featuresRu: ["голеностоп", "профилактика травм", "стабильность"],
    muscleGroup: "Голеностоп",
    equipment: "Без инвентаря/резинка",
    difficulty: "beginner",
    contraindications: "При боли в голеностопе — стоп; не форсировать.",
  },
  {
    name: "Отведение плеча наружу (кабель лёжа)",
    aliases: ["external rotation cable", "ER плеча"],
    descriptionRu: "Изолированная наружная ротация плеча лёжа для манжеты.",
    techniqueRu: "Лёжа на боку, локоть у корпуса, медленная наружная ротация предплечья вверх. Без включения трапеции.",
    featuresRu: ["манжета", "ротаторы плеча", "здоровье плеча"],
    muscleGroup: "Плечо",
    equipment: "Кабель",
    difficulty: "beginner",
    contraindications: "При передней боли в плече — снизить объём.",
  },
  {
    name: "Сгибание предплечья (хват/кисть)",
    aliases: ["wrist curl", "хват"],
    descriptionRu: "Сгибание кисти с весом для предплечья и хвата.",
    techniqueRu: "Предплечье на бедре/скамье, медленное сгибание/разгибание кисти. Контроль амплитуды.",
    featuresRu: ["предплечье", "хват", "буферизация локтя"],
    muscleGroup: "Предплечье",
    equipment: "Гантель/блок",
    difficulty: "beginner",
    contraindications: null,
  },
  {
    name: "Паллоф-пресс",
    aliases: ["pallof press", "антиротация кор"],
    descriptionRu: "Жим троса от груди с сохранением нейтрального туловища — антиротация кор.",
    techniqueRu: "Стоя боком к тросу, жим от груди вперёд с удержанием таза/плеч без поворота. Медленно.",
    featuresRu: ["антиротация", "кор", "защита поясницы"],
    muscleGroup: "Кор",
    equipment: "Резинка/трос",
    difficulty: "beginner",
    contraindications: null,
  },
  {
    name: "Ротационный бросок медбола",
    aliases: ["med ball rotation", "медбол ротация"],
    descriptionRu: "Взрывной поворот туловища с броском медбола — ротационная мощь.",
    techniqueRu: "Поворот корпуса с броском медбола в стену/партнёру. Взрывно, но без переразгибания поясницы. Только после разминки.",
    featuresRu: ["ротационная мощь", "X-factor", "взрывная сила"],
    muscleGroup: "Кор/плечо",
    equipment: "Медбол",
    difficulty: "intermediate",
    contraindications: "Только после разминки; при боли в пояснице — стоп.",
  },
  {
    name: "Боковые запрыгивания/приземления",
    aliases: ["lateral bound", "боковые прыжки"],
    descriptionRu: "Латеральные прыжки с мягким приземлением — плиометрика.",
    techniqueRu: "Прыжок в сторону с мягким приземлением на опорную ногу, без вальгуса колена. Рост высоты постепенно.",
    featuresRu: ["плиометрика", "латеральная мощь", "приземление"],
    muscleGroup: "НК/стабильность",
    equipment: "Тумба",
    difficulty: "intermediate",
    contraindications: "Только после блока стабильности; при боли в колене/ахилле — стоп.",
  },
  {
    name: "Кабель-ротация туловища",
    aliases: ["cable rotation", "ротация кор"],
    descriptionRu: "Поворот туловища с тросом — силовая ротация (X-factor).",
    techniqueRu: "Стоя боком к тросу, поворот корпуса с тягой рукояти к себе. Таз стабилен, поясница нейтральна.",
    featuresRu: ["ротация", "X-factor", "сила туловища"],
    muscleGroup: "Кор",
    equipment: "Кабель",
    difficulty: "intermediate",
    contraindications: null,
  },
  {
    name: "Боковая планка",
    aliases: ["side plank", "планка боковая"],
    descriptionRu: "Планка на боку — анти-латеральная флексия.",
    techniqueRu: "Упор на предплечье/стопу сбоку, тело прямой линией, без провисания таза. Дыхание спокойное.",
    featuresRu: ["анти-латеральная флексия", "кор", "стабильность"],
    muscleGroup: "Кор",
    equipment: "Без инвентаря",
    difficulty: "beginner",
    contraindications: null,
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
        console.warn(`  ${ex.name}: race на name_key — skip`);
      } else {
        console.error(`  ${ex.name}: ошибка вставки — ${error.message}`);
      }
      continue;
    }
    console.log(`  + упражнение: ${ex.name}`);
  }
}

async function main(): Promise<void> {
  const content = buildTennisProgram();
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
        sport: "tennis",
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
        sport: "tennis",
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
