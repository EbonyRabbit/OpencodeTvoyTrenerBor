/**
 * Seed: Swimming - силовая база (12 недель, 3 дня/нед, средний уровень).
 * Идемпотентно (программа по title, упражнения по name_key).
 *
 * Run from bot/:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/seed-swimming-program.ts
 */
import "dotenv/config";
import { supabaseAdmin } from "../src/lib/supabase-admin.js";
import { getParsedContent } from "../src/lib/program-utils.js";
import { normalizeExerciseName } from "../src/lib/exercise-library.js";
import type { Json } from "../src/lib/types.js";
import { buildSwimmingProgram } from "./sport-programs/swimming.js";

const PROGRAM_TITLE = "Swimming - силовая база (12 нед, 3 дня)";
const DESCRIPTION =
  "Спорт-специфичный шаблон для пловца среднего уровня: 3 силовых дня. " +
  "Блоки: плечо/манжета/тяга → кор/ротация + ноги → стабильность плеча + кардио. " +
  "Фазы: база → гипертрофия → сила → сила+объём → делoad. Плавание - вне шаблона.";
const EQUIPMENT = "Зал: гантели, гиря 16-24кг, блок, резинка, медбол";

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
    name: "Отведение плеча наружу (кабель лёжа)",
    aliases: ["external rotation cable", "ER плеча"],
    descriptionRu: "Изолированная наружная ротация плеча лёжа для манжеты.",
    techniqueRu: "Лёжа на боку, локоть у корпуса, медленная наружная ротация предплечья вверх без включения трапеции.",
    featuresRu: ["манжета", "ротаторы плеча", "здоровье плеча"],
    muscleGroup: "Плечо",
    equipment: "Кабель",
    difficulty: "beginner",
    contraindications: "При передней боли в плече - снизить объём.",
  },
  {
    name: "Лопаточный отжим (scapular push-up)",
    aliases: ["scapular push up", "отжим лопаток"],
    descriptionRu: "Отжимание с акцентом на сведение/разведение лопаток без сгибания локтей.",
    techniqueRu: "В упоре лёжа, протяжка лопаток вниз-вместе, затем вверх-врозь. Локти прямые.",
    featuresRu: ["стабильность лопатки", "постурал", "здоровье плеча"],
    muscleGroup: "Плечо/кор",
    equipment: "Без инвентаря",
    difficulty: "beginner",
    contraindications: null,
  },
  {
    name: "Подъём носка на себя (передняя большеберцовая)",
    aliases: ["tibial raise", "передняя большеберцовая"],
    descriptionRu: "Подъём носка на себя для передней большеберцовой мышцы.",
    techniqueRu: "Сидя/стоя, медленный подъём носка вверх, без веса. Высокие повторы.",
    featuresRu: ["передняя большеберцовая", "голеностоп", "кик"],
    muscleGroup: "Голень",
    equipment: "Без инвентаря",
    difficulty: "beginner",
    contraindications: null,
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
    name: "Ротационный бросок медбола",
    aliases: ["med ball rotation", "медбол ротация"],
    descriptionRu: "Взрывной поворот туловища с броском медбола - ротационная мощь.",
    techniqueRu: "Поворот корпуса с броском медбола в стену/партнёру. Взрывно, но без переразгибания поясницы. Только после разминки.",
    featuresRu: ["ротационная мощь", "X-factor", "взрывная сила"],
    muscleGroup: "Кор/плечо",
    equipment: "Медбол",
    difficulty: "intermediate",
    contraindications: "Только после разминки; при боли в пояснице - стоп.",
  },
  {
    name: "Боковые запрыгивания/приземления",
    aliases: ["lateral bound", "боковые прыжки"],
    descriptionRu: "Латеральные прыжки с мягким приземлением - плиометрика.",
    techniqueRu: "Прыжок в сторону с мягким приземлением на опорную ногу, без вальгуса колена. Рост высоты постепенно.",
    featuresRu: ["плиометрика", "латеральная мощь", "приземление"],
    muscleGroup: "НК/стабильность",
    equipment: "Тумба",
    difficulty: "intermediate",
    contraindications: "Только после блока стабильности; при боли в колене/ахилле - стоп.",
  },
  {
    name: "Односторонняя румянская тяга",
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
    name: "Плавание",
    aliases: ["swimming", "плаванье"],
    descriptionRu: "Плавание - аэробная кондиция пловца.",
    techniqueRu: "Гребок с ротацией туловища; дыхание по сторонам. В интервалах - удержание заданного темпа/ЗСС.",
    featuresRu: ["аэроб", "кондиция", "плавание"],
    muscleGroup: "Плечо/кардио",
    equipment: "Бассейн/вода",
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
      if (error.code === "23505") console.warn(`  ${ex.name}: race на name_key - skip`);
      else console.error(`  ${ex.name}: ошибка вставки - ${error.message}`);
      continue;
    }
    console.log(`  + упражнение: ${ex.name}`);
  }
}

async function main(): Promise<void> {
  const content = buildSwimmingProgram();
  if (!getParsedContent(content as unknown as Json)) {
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
        sport: "swimming",
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
        sport: "swimming",
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
