/**
 * Seed библиотеки упражнений (Фаза 20).
 *
 * Идемпотентный upsert по name_key:
 *   - нет записи  → insert;
 *   - есть запись → заполняем ТОЛЬКО пустые поля (NULL/пустой массив),
 *     существующий контент не перетирается (тренер мог отредактировать в CRUD).
 *
 * video_url = NULL у всех записей: реальные ссылки добавляются вручную через
 * CRUD-страницу /exercises (https-ссылки, YouTube). Не используем плейсхолдеры-
 * заглушки, чтобы не показывать клиентам битые ссылки.
 *
 * Run from bot/: DOTENV_CONFIG_PATH=.env.local npx tsx scripts/seed-exercise-library.ts
 */
import "dotenv/config";
import { supabaseAdmin } from "../src/lib/supabase-admin.js";
import { normalizeExerciseName } from "../src/lib/exercise-library.js";

interface SeedExercise {
  name: string;
  aliases: string[];
  descriptionRu: string;
  descriptionEn: string;
  techniqueRu: string;
  techniqueEn: string;
  featuresRu: string[];
  featuresEn: string[];
}

const EXERCISES: SeedExercise[] = [
  // ---------------------------------------------------------------- топ-15
  {
    name: "Жим штанги лёжа",
    aliases: ["Жим лёжа", "Жим штанги лежа", "Бенч-пресс", "Bench Press", "Жим штанги лёжа (лёгкий)", "Жим штанги лёжа — тест на макс. повторы"],
    descriptionRu: "Базовое упражнение на грудные мышцы, передние дельты и трицепс.",
    descriptionEn: "Basic compound exercise for chest, front delts and triceps.",
    techniqueRu: "Лягте на скамью, лопатки сведите и прижмите к скамье. Возьмите штангу чуть шире плеч, снимите и опускайте до касания груди, локти под углом 45° к корпусу. Жмите вверх до полного выпрямления, стопы плотно на полу.",
    techniqueEn: "Lie on the bench, squeeze your shoulder blades and keep them pressed. Grip the bar slightly wider than shoulders, lower it to touch your chest with elbows at ~45°. Press up until arms are locked, feet planted.",
    featuresRu: ["Лопатки прижаты весь подход", "Ноги создают упор, а не лежат свободно", "Касание груди — контроль, а не отскок штанги"],
    featuresEn: ["Keep shoulder blades retracted", "Drive through your feet", "Touch the chest under control"],
  },
  {
    name: "Приседания со штангой",
    aliases: ["Присед со штангой", "Приседания", "Squat", "Back Squat", "Приседания со штангой на спине"],
    descriptionRu: "Король упражнений: квадрицепсы, ягодицы, мышцы кора и спины.",
    descriptionEn: "The king of exercises: quads, glutes, core and back.",
    techniqueRu: "Штанга на трапециях, стопы на ширине плеч, носки чуть наружу. На вдохе сядьте вниз, колени в сторону носков, спина нейтральная, взгляд вперёд. Из нижней точки мощно встаньте, колени и бёдра распрямляются одновременно.",
    techniqueEn: "Bar on your traps, feet shoulder-width, toes slightly out. Inhale and squat down, knees tracking over toes, spine neutral. Drive up powerfully, hips and knees extend together.",
    featuresRu: ["Колени не «проваливаются» внутрь", "Поясница не округляется внизу", "Взгляд вперёд, не вверх и не в пол"],
    featuresEn: ["Keep knees from caving in", "Don't round the lower back", "Eyes forward, not up"],
  },
  {
    name: "Становая тяга",
    aliases: ["Становая тяга со штангой", "Мёртвая тяга", "Deadlift"],
    descriptionRu: "Мощнейшее упражнение на спину, ягодицы и заднюю поверхность бедра.",
    descriptionEn: "Powerful movement for back, glutes and hamstrings.",
    techniqueRu: "Штанга над серединой стопы, хват на ширине плеч. Наклонитесь, колени чуть согнуты, спина прямая. Подъём начинайте с работающих ног, штанга скользит по ногам, корпус выпрямляется в верхней точке.",
    techniqueEn: "Bar over mid-foot, grip shoulder-width. Hinge down with slightly bent knees, back flat. Push with your legs, bar stays close to the body, stand tall at the top.",
    featuresRu: ["Спина прямая, лопатки не тяги (руки — «крюки»)", "Штанга максимально близко к ногам", "Не переразгибайтесь вверх"],
    featuresEn: ["Keep the back flat — arms are hooks", "Drag the bar up your legs", "Don't overextend at the top"],
  },
  {
    name: "Тяга штанги в наклоне",
    aliases: ["Тяга в наклоне", "Bent Over Row", "Тяга штанги к поясу"],
    descriptionRu: "Упражнение на широчайшие, трапеции и поясницу.",
    descriptionEn: "Works lats, traps and lower back.",
    techniqueRu: "Наклон корпуса ~45°, спина прямая, штанга в опущенных руках. Тяните штангу к животу, сводя лопатки, локти идут назад и вверх. Плавно опускайте, не раскачивая корпус.",
    techniqueEn: "Hinge to ~45°, back flat, bar at arm's length. Pull the bar to your belly, squeezing shoulder blades, elbows back. Lower under control without swinging.",
    featuresRu: ["Корпус неподвижен, без рывков", "Локти ближе к корпусу — больше широчайшие", "Руки не сгибаются в полную «молоток»"],
    featuresEn: ["Keep torso still", "Elbows close to the body for lats", "No swinging"],
  },
  {
    name: "Жим гантелей лёжа",
    aliases: ["Жим гантелей", "Жим гантелями", "Dumbbell Bench Press", "Жим гантелей лёжа (на коврике)"],
    descriptionRu: "Большее вовлечение стабилизаторов и большая амплитуда, чем со штангой.",
    descriptionEn: "More stabilizers engaged and a larger range of motion than with a barbell.",
    techniqueRu: "Лягте на скамью с гантелями у плеч. Выжимайте вверх, сводя гантели в верхней точке к центру груди, локти под 45°. Опускайте подконтрольно до глубокого растяжения грудных.",
    techniqueEn: "Lie on the bench, dumbbells at your shoulders. Press up and slightly inwards, elbows at 45°. Lower to a deep chest stretch.",
    featuresRu: ["Согласованное движение обеих рук", "Глубокое опускание при здоровых плечах", "Не стучите гантелями вверху"],
    featuresEn: ["Keep both arms in sync", "Lower to a full stretch", "Don't clank the dumbbells"],
  },
  {
    name: "Разводка гантелей лёжа",
    aliases: ["Разводка гантелей", "Dumbbell Fly", "Пуловер грудной развод"],
    descriptionRu: "Изолированная растяжка грудных мышц.",
    descriptionEn: "Isolated chest stretch and pump.",
    techniqueRu: "Лягте, руки с гантелями над грудью, локти чуть согнуты. Разводите руки в стороны по дуге до комфортного растяжения, затем сводите обратно, сохраняя угол в локтях.",
    techniqueEn: "Lie with dumbbells over your chest, elbows slightly bent. Open your arms in an arc to a comfortable stretch, then bring them back, keeping the elbow angle.",
    featuresRu: ["Угол в локтях не меняется", "Не опускайте гантели ниже плеч при слабых плечах", "Лёгкий-средний вес"],
    featuresEn: ["Fixed elbow angle", "Don't overextend with heavy weight", "Moderate loads"],
  },
  {
    name: "Подтягивания",
    aliases: ["Подтягивание", "Подтягивания на перекладине", "Pull-up", "Pull Ups", "Подтягивания с весом"],
    descriptionRu: "Королевское упражнение на широчайшие и бицепс с собственным весом.",
    descriptionEn: "The king of vertical pulling: lats and biceps with bodyweight.",
    techniqueRu: "Хват чуть шире плеч, грудь вперёд. Тяните локти вниз, подтягиваясь до подбородка над перекладиной. Опускайтесь подконтрольно до полного выпрямления рук.",
    techniqueEn: "Grip slightly wider than shoulders, chest up. Pull elbows down until your chin clears the bar. Lower under control to a full hang.",
    featuresRu: ["Без раскачивания корпусом", "Полное выпрямление внизу", "До подбородка минимум"],
    featuresEn: ["No kipping", "Full lockout at the bottom", "Chin over the bar"],
  },
  {
    name: "Отжимания",
    aliases: ["Отжимание", "Отжимания от пола", "Push-up", "Push Ups", "Отжимания от пола (ноги на диван / колени)", "Отжимания от пола (с колен/полные)"],
    descriptionRu: "Базовое упражнение на грудь, плечи и трицепс с собственным весом.",
    descriptionEn: "Bodyweight pressing for chest, shoulders and triceps.",
    techniqueRu: "Планка на прямых руках, ладони под плечами. Опускайтесь, локти под 45°, грудь почти касается пола, корпус — прямая линия. Выжимайте до полного выпрямления.",
    techniqueEn: "High plank, hands under shoulders. Lower with elbows at 45°, chest almost touches the floor, body in a straight line. Press back up.",
    featuresRu: ["Корпус — прямая линия, таз не провисает", "Локти ближе к корпусу", "Упрощение: с колен"],
    featuresEn: ["Straight body line", "Elbows tucked ~45°", "Easier: from the knees"],
  },
  {
    name: "Выпады с гантелями",
    aliases: ["Выпады шагающие с гантелями", "Выпады", "Lunges", "Выпады с sandbag (20 кг)"],
    descriptionRu: "Односторонняя работа ног-ягодиц, тренирует баланс.",
    descriptionEn: "Single-leg work for glutes and quads plus balance.",
    techniqueRu: "Сделайте широкий шаг вперёд и опустите заднее колено к полу. Переднее колено над стопой, корпус вертикален. Оттолкнитесь передней ногой и вернитесь в исходное.",
    techniqueEn: "Step forward and lower the back knee to the floor. Front knee over the front foot, torso upright. Push off the front leg to return.",
    featuresRu: ["Колено передней ноги над стопой", "Не наклоняйтесь вперёд", "Держите баланс без опоры, если можете"],
    featuresEn: ["Front knee over the foot", "Stay upright", "Balance without support when possible"],
  },
  {
    name: "Румынская тяга с гантелями",
    aliases: ["Румынская тяга", "RDL", "Romanian Deadlift", "Румынская тяга на одной ноге (гантель)"],
    descriptionRu: "Лучшее упражнение для задней поверхности бедра и ягодиц.",
    descriptionEn: "The best exercise for hamstrings and glutes.",
    techniqueRu: "Стоя с гантелями у бёдер, колени чуть согнуты. Отводите таз назад, наклоняя корпус с прямой спиной, гантели скользят по ногам до растяжения задней поверхности. Вернитесь, сжимая ягодицы.",
    techniqueEn: "Stand with dumbbells at your hips, knees slightly bent. Push hips back, hinging with a flat back, dumbbells slide down the legs. Return squeezing glutes.",
    featuresRu: ["Спина прямая весь подход", "Тяните таз назад, а не «садитесь»", "Растяжение внизу — контролируемое"],
    featuresEn: ["Flat back throughout", "Push hips back", "Stretch at the bottom is controlled"],
  },
  {
    name: "Гоблет-приседания",
    aliases: ["Гоблет-присед", "Goblet Squat", "Приседания с гантелями (гоблет)", "Гоблет-присед (16 кг)"],
    descriptionRu: "Дружелюбная к технике версия приседаний с гантелью у груди.",
    descriptionEn: "A technique-friendly squat variation with a dumbbell held at the chest.",
    techniqueRu: "Держите гантель вертикально у груди, локти вниз. Приседайте между коленей, стопы чуть шире плеч, корпус вертикален. Вставайте через упор в пол.",
    techniqueEn: "Hold the dumbbell vertically at your chest, elbows down. Squat between your knees — feet slightly wider, torso upright. Stand up driving through the floor.",
    featuresRu: ["Локти между коленями внизу", "Пятки не отрываются", "Отлично для новичков"],
    featuresEn: ["Elbows go between knees at the bottom", "Heels stay down", "Great for beginners"],
  },
  {
    name: "Бёрпи",
    aliases: ["Берпи", "Burpee", "Берпи без прыжка", "Бёрпи без прыжка"],
    descriptionRu: "Полноценное кардио-силовое движение на всё тело.",
    descriptionEn: "Full-body conditioning movement.",
    techniqueRu: "Присед, ладони на пол, прыжком уйдите в планку. Отжимание (по желанию), прыжком верните ноги к рукам и выпрыгните вверх. Всё одним ритмичным потоком.",
    techniqueEn: "Squat down, palms on the floor, kick back to a plank. Optional push-up, jump feet back in, and jump up. Keep a steady rhythm.",
    featuresRu: ["Спина прямая в планке", "Прыжки мягкие, на полной стопе", "Упрощение: ходьба ногами вместо прыжка"],
    featuresEn: ["Flat back in the plank", "Land softly on full feet", "Easier: step back instead of jumping"],
  },
  {
    name: "Планка",
    aliases: ["Планка прямая", "Планка с отягощением", "Планка боковая", "Планка прямая и боковая", "Plank"],
    descriptionRu: "Статическое упражнение на глубокие мышцы кора.",
    descriptionEn: "Isometric core exercise.",
    techniqueRu: "Предплечья на полу, локти под плечами, корпус — прямая линия от стоп до головы. Пресс напряжён, ягодицы сжаты, не прогибайтесь в пояснице. Дышите ровно.",
    techniqueEn: "Forearms on the floor, elbows under shoulders, body in a straight line. Brace the core and glutes, don't sag the lower back. Breathe steadily.",
    featuresRu: ["Таз не провисает и не задирается", "Взгляд в пол", "Наилучшее время — больше не значит лучше"],
    featuresEn: ["No sagging or piking the hips", "Eyes on the floor", "Perfect form over long time"],
  },
  {
    name: "Жим штанги стоя",
    aliases: ["Армейский жим", "Жим стоя", "Overhead Press", "Жим штанги над головой"],
    descriptionRu: "Силовое жимовое движение на плечи и верх груди.",
    descriptionEn: "The main overhead pressing strength movement.",
    techniqueRu: "Штанга на ключицах, хват на ширине плеч, корпус напряжён. Выжимайте вертикально вверх, уводя голову назад, затем она возвращается под штангу. Не прогибайтесь в пояснице.",
    techniqueEn: "Bar at the collarbones, grip shoulder-width, core tight. Press vertically, moving your head back slightly, then bring it back under the bar. Avoid overarching the lower back.",
    featuresRu: ["Ягодицы и пресс напряжены", "Движение строго вертикально", "Новичкам: жим гантелей сидя"],
    featuresEn: ["Squeeze glutes and abs", "Press straight up", "Beginners: seated dumbbell press"],
  },
  {
    name: "Тяга горизонтальная в тренажёре",
    aliases: ["Тяга горизонтальная", "Seated Cable Row", "Тяга горизонтальная (лёгкий)", "Тяга горизонтальная — тест на макс. повторы"],
    descriptionRu: "Упражнение на середину спины и бицепс без нагрузки на поясницу.",
    descriptionEn: "Cable row for the mid-back and biceps without lower back stress.",
    techniqueRu: "Сядьте прямо, грудь вперёд. Тяните рукоять к животу, локти назад, сводя лопатки. Плавно возвращайте, не округляя спину и не откидываясь корпусом.",
    techniqueEn: "Sit tall, chest up. Pull the handle to your belly, elbows back, squeezing shoulder blades. Return smoothly without rounding or rocking.",
    featuresRu: ["Корпус неподвижен", "Пауза при сведённых лопатках", "Спина не округляется"],
    featuresEn: ["Torso stays still", "Pause with blades squeezed", "Don't round the back"],
  },
  // ------------------------------------------------------------- остальные
  {
    name: "Жим ногами в тренажёре",
    aliases: ["Жим ногами", "Leg Press", "Жим ногами (лёгкий вес)", "Жим ногами — тест на макс. повторы"],
    descriptionRu: "Присед в тренажёре: квадрицепсы и ягодицы без нагрузки на поясницу.",
    descriptionEn: "Leg press: quads and glutes without lower back loading.",
    techniqueRu: "Стопы на платформе на ширине плеч, спина прижата к спинке. Опускайте платформу до угла 90° в коленях, не отрывая таз. Выжимайте без полного «щёлчка» коленей.",
    techniqueEn: "Feet shoulder-width on the platform, back against the pad. Lower to ~90° at the knees without lifting the hips. Press up without locking the knees hard.",
    featuresRu: ["Колени в сторону носков", "Таз прижат на протяжении подхода", "Не стучите платформой"],
    featuresEn: ["Knees track over toes", "Hips stay on the pad", "No bouncing the platform"],
  },
  {
    name: "Тяга верхнего блока",
    aliases: ["Тяга верхнего блока широким хватом", "Lat Pulldown", "Тяга верхнего блока шире плеч хватом", "Тяга верхнего блока обратным хватом"],
    descriptionRu: "Вертикальная тяга — подготовка к подтягиваниям.",
    descriptionEn: "Vertical pull — a progression toward pull-ups.",
    techniqueRu: "Сядьте, бёдра зафиксированы валиком, грудь вперёд. Тяните перекладину к верхней части груди, локти вниз-назад. Плавно возвращайте вверх до полного выпрямления рук.",
    techniqueEn: "Sit with thighs secured, chest up. Pull the bar to your upper chest with elbows down and back. Return smoothly to a full stretch.",
    featuresRu: ["Не отклоняйтесь назад", "Тяните к груди, не за голову", "Кисти не доминируют над тягой"],
    featuresEn: ["Avoid rocking back", "Pull to the chest", "Let the back do the work"],
  },
  {
    name: "Тяга гантели в наклоне",
    aliases: ["Тяга гантели одной рукой", "Dumbbell Row", "Тяга гантели в упоре на скамью", "Тяга 1 гантели в упоре на скамью"],
    descriptionRu: "Односторонняя тяга на широчайшие и середину спины.",
    descriptionEn: "Single-arm row for lats and mid-back.",
    techniqueRu: "Упор коленом и рукой на скамью, гантель в свободной руке. Тяните гантель к бедру, локоть у корпуса. Опускайте до полного растяжения, корпус неподвижен.",
    techniqueEn: "Support knee and hand on a bench, dumbbell in the free hand. Pull it to your hip with the elbow close. Lower to a full stretch, torso locked.",
    featuresRu: ["Не скручивайте корпус", "Локоть ближе к корпусу", "Полное опускание вниз"],
    featuresEn: ["Don't rotate the torso", "Elbow close to the body", "Full stretch at the bottom"],
  },
  {
    name: "Тяга к лицу",
    aliases: ["Тяга широким хватом к лицу стоя", "Face Pull", "Тяга резинки к лицу (Face Pull)"],
    descriptionRu: "Здоровье плеч: задняя дельта и ротаторная манжета.",
    descriptionEn: "Shoulder health: rear delts and rotator cuff.",
    techniqueRu: "Канат или резинка на уровне лица. Тяните к лицу, разводя руки в стороны, локти выше запястий. Плавно возвращайте, контролируя натяжение.",
    techniqueEn: "Rope or band at face height. Pull to your face, opening your arms, elbows above wrists. Return with control.",
    featuresRu: ["Локти выше запястий", "Лёгкий-средний вес", "Идеально перед жимовыми"],
    featuresEn: ["Elbows above wrists", "Light to moderate weight", "Great before pressing work"],
  },
  {
    name: "Болгарские выпады",
    aliases: ["Болгарский сплит-присед", "Bulgarian Split Squat", "Болгарские выпады с гантелями"],
    descriptionRu: "Жёсткая односторонняя работа ног с опорой задней ногой на возвышение.",
    descriptionEn: "Tough single-leg work with the rear foot elevated.",
    techniqueRu: "Задняя стопа на скамье, передняя — на полу. Опускайтесь вертикально, переднее колено над стопой. Вставайте без опоры на заднюю ногу.",
    techniqueEn: "Rear foot on a bench, front foot planted. Lower straight down, front knee over the foot. Stand up without pushing off the rear leg.",
    featuresRu: ["Корпус вертикален", "Минимум нагрузки на заднюю стопу", "Начните без веса"],
    featuresEn: ["Stay upright", "Rear foot for balance only", "Start unweighted"],
  },
  {
    name: "Выпады назад с гантелями",
    aliases: ["Обратные выпады", "Reverse Lunge", "Выпады назад"],
    descriptionRu: "Щадящая для коленей разновидность выпадов, акцент на ягодицы.",
    descriptionEn: "Knee-friendly lunge variation with a glute emphasis.",
    techniqueRu: "С гантелями в руках шагните назад одной ногой, опуская заднее колено к полу. Передняя нога работает основной. Вернитесь шагом вперёд.",
    techniqueEn: "With dumbbells, step back and lower the rear knee. Drive mostly through the front leg to return.",
    featuresRu: ["Переднее колено над стопой", "Ритмичный шаг, без подпрыгиваний", "Передняя нога — основная"],
    featuresEn: ["Front knee over the foot", "Steady rhythm", "Front leg does the work"],
  },
  {
    name: "Боковые выпады",
    aliases: ["Выпад в сторону", "Side Lunge"],
    descriptionRu: "Движение в боковой плоскости: приводящие бедра и ягодицы.",
    descriptionEn: "Frontal-plane movement: adductors and glutes.",
    techniqueRu: "Шагните широко в сторону, вес на согнутую ногу, таз назад. Вторая нога прямая, стопы на полу. Оттолкнитесь и вернитесь.",
    techniqueEn: "Step wide to the side, sitting into the bent leg with hips back. The other leg stays straight. Push off to return.",
    featuresRu: ["Пятка рабочей ноги прижата", "Колено в сторону носка", "Корпус не заваливается"],
    featuresEn: ["Working heel stays down", "Knee over the toes", "Keep the torso tall"],
  },
  {
    name: "Ягодичный мостик с гантелью",
    aliases: ["Ягодичный мост с гантелью на бёдрах", "Ягодичный мостик", "Glute Bridge", "Резинка — ягодичный мостик с разведением"],
    descriptionRu: "Целевая работа на ягодицы без нагрузки на поясницу.",
    descriptionEn: "Targeted glute work without lower back stress.",
    techniqueRu: "Лягте на спину, стопы на полу, гантель на бёдрах. Поднимайте таз до прямой линии корпус-бёдра, сжимая ягодицы вверху. Опускайте без касания пола.",
    techniqueEn: "Lie on your back, feet on the floor, dumbbell on the hips. Lift until the body forms a straight line, squeezing glutes at the top. Lower without touching down.",
    featuresRu: ["Подъём за счёт ягодиц, не поясницы", "Пауза-сжатие вверху", "Лопатки опора"],
    featuresEn: ["Lift with glutes, not the lower back", "Squeeze at the top", "Supported on the shoulder blades"],
  },
  {
    name: "Сгибание рук с гантелями",
    aliases: ["Сгибания рук с гантелями", "Сгибания на бицепс", "Bicep Curl", "Сгибание рук с гантелями (бицепс)", "Сгибание рук со штангой"],
    descriptionRu: "Изоляция бицепса.",
    descriptionEn: "Biceps isolation.",
    techniqueRu: "Стоя или сидя, локти прижаты к корпусу. Сгибайте руки, без раскачивания и движения плечами. Опускайте медленно, полностью выпрямляя.",
    techniqueEn: "Stand or sit, elbows pinned to the sides. Curl up without swinging, then lower slowly to full extension.",
    featuresRu: ["Локти неподвижны", "Опускание медленнее подъёма", "Кисти не сгибаются к себе"],
    featuresEn: ["Elbows stay fixed", "Lower slower than you curl", "Keep wrists neutral"],
  },
  {
    name: "Разгибание руки с гантелью из-за головы",
    aliases: ["Французский жим с гантелью", "Overhead Triceps Extension", "Разгибание руки с гантелью из-за головы (трицепс)"],
    descriptionRu: "Изолированная растяжка трицепса.",
    descriptionEn: "Isolated triceps stretch.",
    techniqueRu: "Гантель над головой в обеих руках. Опускайте за голову, сгибая локти, плечи неподвижны. Поднимайте, полностью выпрямляя локти.",
    techniqueEn: "Hold a dumbbell overhead with both hands. Lower it behind your head by bending the elbows, keeping upper arms still. Extend fully.",
    featuresRu: ["Плечи не двигаются", "Локти ближе к голове", "Лёгкий вес"],
    featuresEn: ["Upper arms stay put", "Elbows tucked in", "Light weight"],
  },
  {
    name: "Отжимания узким хватом",
    aliases: ["Отжимания узким хватом (с колен/полные)", "Close-grip Push-up"],
    descriptionRu: "Вариант отжиманий с акцентом на трицепс.",
    descriptionEn: "Push-up variation emphasizing the triceps.",
    techniqueRu: "Ладони уже плеч, локти прижаты к корпусу. Опускайтесь, ведя локти строго назад, грудь к полу. Выжимайте до полного выпрямления.",
    techniqueEn: "Hands narrower than shoulders, elbows glued to the body. Lower with elbows traveling back, then press up.",
    featuresRu: ["Локти вдоль корпуса", "Не разводите ладони наружу", "Упрощение: с колен"],
    featuresEn: ["Elbows thread along the body", "Keep hands planted", "Easier from the knees"],
  },
  {
    name: "Пуловер с гантелью",
    aliases: ["Пуловер лежа", "Dumbbell Pullover", "Пуловер с гантелью лёжа на диване"],
    descriptionRu: "Комбинированная растяжка груди и широчайших.",
    descriptionEn: "Combined chest and lat stretch.",
    techniqueRu: "Лягте поперёк скамьи, гантель над грудью двумя руками. Опускайте за голову по дуге до комфортного растяжения, локти чуть согнуты. Возвращайте над грудью.",
    techniqueEn: "Lie across a bench, hold a dumbbell over the chest with both hands. Lower behind the head in an arc, elbows softly bent. Bring it back over the chest.",
    featuresRu: ["Таз вниз для растяжки", "Локти лишь чуть согнуты", "Без рывков"],
    featuresEn: ["Dropped hips for the stretch", "Slightly bent elbows", "No jerking"],
  },
  {
    name: "Махи гантелью (свинг)",
    aliases: ["Свинг с гантелью", "Swing", "Махи гирей"],
    descriptionRu: "Взрывное движение на ягодицы, заднюю поверхность и сердечно-сосудистую систему.",
    descriptionEn: "Explosive hip hinge for glutes, hamstrings and conditioning.",
    techniqueRu: "Держите гантель обеими руками внизу. Взмахом таза вперёд поднимайте её до уровня груди, корпус прямой. Пусть движение идёт от бёдер, а не от рук.",
    techniqueEn: "Hold a dumbbell with both hands. Snap your hips forward to swing it to chest height, torso upright. The power comes from the hips, not the arms.",
    featuresRu: ["Толчок от бёдер", "Спина прямая", "Контролируемое опускание"],
    featuresEn: ["Hip-driven", "Flat back", "Control the swing down"],
  },
  {
    name: "Подъём ног в висе",
    aliases: ["Подъём коленей в висе", "Hanging Leg Raise", "Подъёмы ног в висе"],
    descriptionRu: "Продвинутая работа на пресс с подвешиванием на перекладине.",
    descriptionEn: "Advanced abs work hanging from a bar.",
    techniqueRu: "Вися на перекладине, поднимайте колени (или прямые ноги) до уровня груди, скручивая таз наверх. Опускайте подконтрольно без раскачивания.",
    techniqueEn: "Hanging from a bar, raise knees or straight legs to chest level, tucking the pelvis up. Lower under control without swinging.",
    featuresRu: ["Без раскачивания", "Таз подкручен вверху", "Вариант: колени, а не прямые ноги"],
    featuresEn: ["No swinging", "Tuck the pelvis at the top", "Easier: knees bent"],
  },
  {
    name: "Скручивания лёжа",
    aliases: ["Кранчи", "Crunches", "Пресс кранчи"],
    descriptionRu: "Классические скручивания на верхний отдел пресса.",
    descriptionEn: "Classic crunch for the upper abs.",
    techniqueRu: "Лягте, стопы на полу, руки у висков. Поднимайте лопатки от пола за счёт скручивания, поясница прижата. Опускайтесь без касания пола лопатками.",
    techniqueEn: "Lie down, feet planted, hands at your temples. Curl the shoulder blades off the floor, lower back pinned. Lower without fully relaxing.",
    featuresRu: ["Поясница прижата", "Плечи не тянутся к коленям руками", "Локти в стороны"],
    featuresEn: ["Lower back stays down", "Don't pull with your hands", "Elbows wide"],
  },
  {
    name: "Обратные скручивания",
    aliases: ["Reverse Crunch", "Подъём таза лёжа"],
    descriptionRu: "Скручивание снизу: нижний отдел пресса.",
    descriptionEn: "Bottom-up crunch: lower abs.",
    techniqueRu: "Лягте, ноги согнуты, руки вдоль корпуса. Поднимайте таз и ноги к грудной клетке, скручивая поясницу с пола. Опускайте плавно.",
    techniqueEn: "Lie down, knees bent, arms at your sides. Lift the hips and knees toward your chest, peeling the lower back off the floor. Lower smoothly.",
    featuresRu: ["Движение от таза", "Без инерции маха ног", "Пауза в верхней точке"],
    featuresEn: ["Drive from the hips", "No momentum", "Pause at the top"],
  },
  {
    name: "Планка на прямых руках",
    aliases: ["Высокая планка", "High Plank", "Планка с касанием плеч"],
    descriptionRu: "Планка на вытянутых руках — мягче для локтей, чем на предплечьях.",
    descriptionEn: "High plank — easier on the elbows than a forearm plank.",
    techniqueRu: "Ладони под плечами, ноги прямые, корпус — прямая линия. Пресс и ягодицы напряжены, взгляд в пол. Не поднимайте таз вверх.",
    techniqueEn: "Hands under shoulders, legs straight, straight body line. Brace abs and glutes. Don't pike the hips.",
    featuresRu: ["Прямая линия корпус-ноги", "Ладони активно давят в пол", "Дышите ровно"],
    featuresEn: ["Straight body line", "Press the floor away", "Breathe steadily"],
  },
  {
    name: "Степ-ап с гантелями",
    aliases: ["Степ-ап", "Степ-ап на стул/диван с гантелями", "Step-up"],
    descriptionRu: "Подъём на возвышение: ягодицы и квадрицепсы, функциональность в быту.",
    descriptionEn: "Step-ups: glutes and quads with everyday functionality.",
    techniqueRu: "Встаньте перед скамьёй/стулом, гантели в руках. Поставьте одну стопу на опору и поднимитесь без отталкивания второй ногой. Опускайтесь медленно.",
    techniqueEn: "Stand in front of a bench or chair with dumbbells. Place one foot up and stand without pushing with the other leg. Step down slowly.",
    featuresRu: ["Отталкивание рабочей ногой", "Колено в сторону стопы", "Высота опоры ~уровень колена"],
    featuresEn: ["Drive through the working leg", "Knee over the foot", "Bench height about knee level"],
  },
  {
    name: "Боковые подъёмы гантелей",
    aliases: ["Махи в стороны", "Отведение плеч в сторону", "Lateral Raise"],
    descriptionRu: "Изоляция средней дельты для ширины плеч.",
    descriptionEn: "Middle-delt isolation for shoulder width.",
    techniqueRu: "Лёгкие гантели в опущенных руках, локти чуть согнуты. Поднимайте руки в стороны до уровня плеч, без рывка корпусом. Опускайте медленно.",
    techniqueEn: "Light dumbbells, elbows slightly bent. Raise the arms to shoulder height without swinging the torso. Lower slowly.",
    featuresRu: ["Без раскачивания корпуса", "Мизинец чуть выше большого пальца", "Лёгкий вес — больше повторений"],
    featuresEn: ["No torso swing", "Pinky slightly above the thumb", "Light weight, higher reps"],
  },
  {
    name: "Жим гантелей сидя",
    aliases: ["Жим гантелей над головой сидя", "Seated Dumbbell Press", "Жим гантелей сидя (на стуле/диване)", "Жим гантелей стоя"],
    descriptionRu: "Жим над головой для дельт с опорой спины.",
    descriptionEn: "Seated overhead press for the delts.",
    techniqueRu: "Спинка скамьи вертикальная (или почти), гантели у ушей. Выжимайте вверх до полного выпрямления, не сводя гантели. Опускайте до ушей.",
    techniqueEn: "Bench back upright or nearly so, dumbbells at ear level. Press up to full extension without clanking. Lower back to the ears.",
    featuresRu: ["Поясница прижата к спинке", "Локти чуть вперёд внизу", "Не толкайте подбородок вперёд"],
    featuresEn: ["Lower back against the pad", "Elbows slightly forward at the bottom", "Keep the chin neutral"],
  },
  {
    name: "Жим гантелей на наклонной",
    aliases: ["Жим гантелей на наклонной скамье", "Incline Dumbbell Press"],
    descriptionRu: "Жим на наклонной скамье — акцент на верх груди.",
    descriptionEn: "Incline press emphasizing the upper chest.",
    techniqueRu: "Скамья 30-45°, гантели у плеч. Выжимайте вверх, слегка сводя к центру. Не выталкивайте плечи вперёд из ограничителей.",
    techniqueEn: "Bench at 30–45°, dumbbells at the shoulders. Press up slightly inwards. Keep the shoulders back.",
    featuresRu: ["Плечи не выходят вперёд", "Угол скамьи не более 45°", "Плавное опускание"],
    featuresEn: ["Shoulders stay back", "Bench angle max 45°", "Lower under control"],
  },
  {
    name: "Лёгкий бег",
    aliases: ["Бег трусцой", "Лёгкий бег 1 км", "Лёгкий бег 2-3 км", "Бег 1 км", "Бег 2 км", "Бег 3 км", "Running", "Jogging"],
    descriptionRu: "Аэробная база: восстанавливающий бег в разговорном темпе.",
    descriptionEn: "Aerobic base: conversational-pace recovery running.",
    techniqueRu: "Темп, в котором можно говорить. Каденс ~170-180 шагов/мин, приземление на середину стопы, корпус прямой. Начинайте с коротких дистанций и наращивайте постепенно.",
    techniqueEn: "Pace where you can still talk. Cadence ~170–180 steps/min, land mid-foot, torso upright. Start short and build gradually.",
    featuresRu: ["Разговорный темп", "Пульс в зоне 60-70% от макс.", "Приземление мягкое, без «шлёпанья»"],
    featuresEn: ["Conversational pace", "Heart rate at 60–70% of max", "Land softly"],
  },
  {
    name: "Гребной тренажёр",
    aliases: ["Гребля", "Гребля 1000 м", "Rowing", "Erg", "Concept2"],
    descriptionRu: "Полноценная кардио-нагрузка на всё тело без ударной нагрузки.",
    descriptionEn: "Full-body low-impact conditioning.",
    techniqueRu: "Порядок: ноги → корпус → руки. Отталкивайтесь ногами, затем отклоняйте корпус и тяните рукоять к нижним рёбрам. Обратно: руки → корпус → ноги. Спина прямая.",
    techniqueEn: "Sequence: legs → torso → arms. Drive with the legs, swing the torso back, pull to the lower ribs. Return: arms → torso → legs. Keep the back flat.",
    featuresRu: ["Спина прямая весь гребок", "Ноги до 60% работы", "Руки отдыхают на возврате"],
    featuresEn: ["Flat back through the stroke", "Legs do most of the work", "Arms relax on the recovery"],
  },
  {
    name: "Фермерская прогулка",
    aliases: ["Фермерская ходьба", "Farmer's Carry", "Прогулка с гантелями"],
    descriptionRu: "Силовое хождение с отягощением: хват, кор, трапеции.",
    descriptionEn: "Loaded walking: grip, core and traps.",
    techniqueRu: "Возьмите отягощение в обе руки, плечи назад, грудь вперёд. Идите мелкими уверенными шагами, корпус вертикален, без наклона в стороны.",
    techniqueEn: "Pick up the weights, shoulders back, chest up. Walk with short controlled steps, staying tall.",
    featuresRu: ["Плечи не «уши» — лопатки опущены", "Корпус вертикален", "Больше вес — короче дистанция"],
    featuresEn: ["Keep shoulders down", "Stay tall", "Heavier loads, shorter distances"],
  },
  {
    name: "Толкание саней",
    aliases: ["Sled Push", "Санный толчок", "Толчок платформы"],
    descriptionRu: "Мощнейшее кондиционное движение для ног и выносливости.",
    descriptionEn: "Powerful conditioning for legs and work capacity.",
    techniqueRu: "Руки на рукояти на уровне груди, корпус наклонён ~45°, спина прямая. Толкайте короткими мощными шагами, удерживая постоянное давление. Для HYROX-подготовки: чередуйте с бегом.",
    techniqueEn: "Hands on the handles at chest height, torso at ~45°, back flat. Push with short powerful steps, keeping constant pressure. For HYROX prep: alternate with running.",
    featuresRu: ["Спина прямая, не «садитесь»", "Шаги короткие и частые", "Давление постоянное, без пауз"],
    featuresEn: ["Flat back", "Short fast steps", "Keep constant pressure"],
  },
  {
    name: "Трастеры",
    aliases: ["Трастер", "Приседания + жим над головой", "Thruster", "Присед + жим"],
    descriptionRu: "Присед с жимом над головой — силовое кардио на всё тело.",
    descriptionEn: "Squat with an overhead press — full-body strength conditioning.",
    techniqueRu: "Штанга или гантели у плеч. Присядьте и в подъёме выдавите снаряд над головой, не останавливая движение. Опустите снаряд к плечам вместе с новым приседом — один непрерывный поток.",
    techniqueEn: "Bar or dumbbells at your shoulders. Squat, then on the way up press overhead in one motion. Lower to the shoulders as you begin the next rep.",
    featuresRu: ["Единый ритм: присед-жим", "Локти высоко внизу", "Дыхание на каждый повтор"],
    featuresEn: ["Squat and press as one", "Elbows high at the bottom", "Breathe every rep"],
  },
  {
    name: "Подтягивания в гравитроне",
    aliases: ["Гравитрон", "Assisted Pull-up", "Подтягивания с противовесом"],
    descriptionRu: "Подтягивания с поддержкой противовеса — путь к обычным подтягиваниям.",
    descriptionEn: "Assisted pull-ups — a path to regular pull-ups.",
    techniqueRu: "Встаньте коленями на платформу, хват на ширине плеч. Подтягивайтесь до подбородка, сводя лопатки. Опускайтесь полностью, уменьшая вес противовеса с неделями.",
    techniqueEn: "Kneel on the platform, grip shoulder-width. Pull to a chin over the bar, squeezing the blades. Lower fully and reduce assistance over time.",
    featuresRu: ["Меньше противовес — сложнее", "Без отбива внизу", "Лопатки работают вниз"],
    featuresEn: ["Less assistance, harder", "No bounce at the bottom", "Drive the elbows down"],
  },
  {
    name: "Тяга гантели к поясу в упоре",
    aliases: ["Тяга в упоре на колено", "Тяга гантели к поясу (в упоре на колено/диван)", "Тяга гантели к поясу (в упоре на колено)", "Dumbbell Row Bench"],
    descriptionRu: "Домашний вариант односторонней тяги с опорой о диван/стул.",
    descriptionEn: "Home-friendly single-arm row supported on a couch or chair.",
    techniqueRu: "Одна рука и колено на опоре, спина параллельна полу. Тяните гантель к поясу, локоть у корпуса, лопатка сводится. Опускайте до растяжения без ротации корпуса.",
    techniqueEn: "Support one hand and knee, back parallel to the floor. Pull to your belt, elbow close, squeezing the blade. Lower to a stretch without rotating.",
    featuresRu: ["Корпус неподвижен", "Лопатка идёт к позвоночнику", "Опускание медленное"],
    featuresEn: ["Torso locked", "Squeeze the shoulder blade", "Slow lowering"],
  },
  {
    name: "Нордические наклоны",
    aliases: ["Нордик", "Нордические сгибания", "Nordic Curl"],
    descriptionRu: "Эксцентрическая работа на заднюю поверхность бедра — профилактика травм.",
    descriptionEn: "Eccentric hamstring work — injury prevention.",
    techniqueRu: "Колени на полу, стопы зафиксированы партнёром/упором. Наклоняйтесь вперёд с прямой линией корпус-бёдра максимально медленно. Руками разрешается помощь в конце.",
    techniqueEn: "Kneel with feet anchored. Lower forward with a straight body line as slowly as possible, using your hands for support only at the end.",
    featuresRu: ["Наклон максимально медленный", "Спина прямая", "Начните с малой амплитуды"],
    featuresEn: ["Lower as slowly as possible", "Keep the back flat", "Start with a short range"],
  },
  {
    name: "Русский твист",
    aliases: ["Русский скрут", "Russian Twist", "Русский твист с гантелью"],
    descriptionRu: "Динамические ротации корпуса: косые мышцы живота.",
    descriptionEn: "Dynamic torso rotation: obliques.",
    techniqueRu: "Сидя, корпус отклонён на 45°, стопы на полу или на весу. Поворачивайте корпус из стороны в сторону, отягощение у груди. Взгляд следует за руками.",
    techniqueEn: "Sit with the torso leaned to 45°, feet on the floor or lifted. Rotate side to side, weight at your chest, eyes following the hands.",
    featuresRu: ["Вращение от грудной клетки", "Поясница стабильна", "Темп средний, без инерции"],
    featuresEn: ["Rotate from the chest", "Lower back stable", "Moderate tempo, no momentum"],
  },
  {
    name: "Ротации с резинкой",
    aliases: ["Дровосек", "Woodchopper", "Ротации с резинкой (дровосек)"],
    descriptionRu: "Диагональные ротации с резинкой: косые и стабильность плеч.",
    descriptionEn: "Diagonal band rotations: obliques and shoulder stability.",
    techniqueRu: "Резинка закреплена низко, стойте боком. Тяните её по диагонали вверх через корпус, следуя руками. Медленно возвращайте, контролируя натяжение.",
    techniqueEn: "Anchor the band low and stand sideways. Pull it diagonally up across your body, following with your hands. Return slowly with control.",
    featuresRu: ["Движение по диагонали", "Корпус вращается, ноги стоят", "Контроль на возврате"],
    featuresEn: ["Move diagonally", "Hips stay square", "Control the return"],
  },
  {
    name: "Подъёмы ног лёжа",
    aliases: ["Подъём ног на спине", "Подъёмы ног лёжа (низ живота)", "Leg Raises"],
    descriptionRu: "Доступный вариант на нижний отдел пресса с поясницей на полу.",
    descriptionEn: "Accessible lower-ab work with the back on the floor.",
    techniqueRu: "Лягте, ноги прямые или согнуты, поясница прижата. Поднимайте ноги до вертикали и опускайте, не отрывая поясницу от пола. Упрощение: согнутые колени.",
    techniqueEn: "Lie down, legs straight or bent, lower back pinned. Raise the legs to vertical and lower without arching the back. Easier: bent knees.",
    featuresRu: ["Поясница прижата", "Опускание медленное", "Колени согнуты = проще"],
    featuresEn: ["Back stays glued", "Lower slowly", "Bent knees are easier"],
  },
  {
    name: "Разведение рук с резинкой",
    aliases: ["Резинка — разведение рук (задняя дельта)", "Резинка — разведение рук назад", "Band Rear Delt Fly"],
    descriptionRu: "Разведение рук с резинкой — задняя дельта и осанка.",
    descriptionEn: "Band fly for the rear delts and posture.",
    techniqueRu: "Держите резинку перед собой на уровне груди в натянутом состоянии в руках. Разводите руки в стороны, сводя лопатки. Возвращайте медленно.",
    techniqueEn: "Hold the band taut in front of your chest. Pull the hands apart, squeezing the blades together. Return slowly.",
    featuresRu: ["Чуть согнутые локти", "Лопатки сводятся", "Постоянное натяжение резинки"],
    featuresEn: ["Softly bent elbows", "Squeeze the blades", "Keep the band taut"],
  },
  {
    name: "Боковые шаги с резинкой",
    aliases: ["Резинка — боковые шаги (мини-банда)", "Band Lateral Walk", "Боковые шаги с мини-бандой"],
    descriptionRu: "Боковые шаги с мини-бандой — средняя ягодичная мышца.",
    descriptionEn: "Mini-band lateral walks — gluteus medius.",
    techniqueRu: "Мини-банда выше колен или на щиколотках, ноги на ширине таза. Шагайте в сторону, сохраняя корпус вертикально и напряжение ленты. Вернитесь обратно.",
    techniqueEn: "Mini band above the knees or at the ankles, squatting slightly. Step sideways staying tall and keeping the band tension. Step back.",
    featuresRu: ["Лента всегда натянута", "Корпус не наклоняется", "Носки вперёд"],
    featuresEn: ["Keep the band taut", "Stay tall", "Toes forward"],
  },
  {
    name: "Отведение плеча назад",
    aliases: ["Отведение руки в наклоне", "Rear Delt Raise", "Резинка — разведение рук в наклоне"],
    descriptionRu: "Изолированная работа задней дельты в наклоне.",
    descriptionEn: "Isolated rear-delt work in a hinge.",
    techniqueRu: "Наклонитесь с прямой спиной, руки с лёгкими гантелями вниз. Разводите руки в стороны-назад, локти чуть согнуты. Опускайте медленно.",
    techniqueEn: "Hinge forward with a flat back, light weights in hand. Raise the arms out and back with soft elbows. Lower slowly.",
    featuresRu: ["Локти чуть согнуты", "Без ротации корпуса", "Лёгкий вес"],
    featuresEn: ["Soft elbows", "No torso rotation", "Light weight"],
  },
  {
    name: "Ягодичный мостик с резинкой",
    aliases: ["Боковой мостик с резинкой", "Glute Bridge Band", "Резинка — ягодичный мостик"],
    descriptionRu: "Мостик с разведением коленей с лентой — ягодицы + абдукторы.",
    descriptionEn: "Bridge with banded knee openers — glutes plus abductors.",
    techniqueRu: "Банда на коленях, лягте на спину, стопы на полу. Поднимайте таз, одновременно разводя колени в стороны. Вверху удерживайте давление на ленту.",
    techniqueEn: "Band above the knees, lie on your back, feet planted. Lift the hips while pressing the knees outward. Hold the band tension at the top.",
    featuresRu: ["Колени не «проваливаются» внутрь", "Пауза вверху", "Поясница не переразгибается"],
    featuresEn: ["Keep the knees pressed out", "Pause at the top", "Don't overarch the back"],
  },
];

interface ExistingRow {
  id: string;
  aliases: string[];
  technique_ru: string | null;
  technique_en: string | null;
  description_ru: string | null;
  description_en: string | null;
  features_ru: string[];
  features_en: string[];
  video_url: string | null;
}

function isFilled(value: string | null | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

async function main(): Promise<void> {
  const nameKeys = EXERCISES.map((ex) => normalizeExerciseName(ex.name));

  const { data: existingRows, error: selectError } = await supabaseAdmin
    .from("exercises")
    .select("id, name_key, aliases, technique_ru, technique_en, description_ru, description_en, features_ru, features_en, video_url")
    .in("name_key", nameKeys);
  if (selectError) {
    console.error("Failed to load existing exercises:", selectError.message);
    process.exit(1);
  }
  const existingByKey = new Map<string, ExistingRow>(
    (existingRows ?? []).map((row) => [row.name_key, row as ExistingRow]),
  );

  let inserted = 0;
  let updated = 0;
  let untouched = 0;

  for (const ex of EXERCISES) {
    const nameKey = normalizeExerciseName(ex.name);
    const row: ExistingRow | undefined = existingByKey.get(nameKey);

    if (!row) {
      const { error } = await supabaseAdmin.from("exercises").insert({
        name: ex.name,
        name_key: nameKey,
        aliases: ex.aliases,
        description_ru: ex.descriptionRu,
        description_en: ex.descriptionEn,
        technique_ru: ex.techniqueRu,
        technique_en: ex.techniqueEn,
        features_ru: ex.featuresRu,
        features_en: ex.featuresEn,
        video_url: null,
        muscle_group: null,
        equipment: null,
        difficulty: null,
        contraindications: null,
      });
      if (error) {
        if (error.code === "23505") {
          console.warn(`  ${ex.name}: race on name_key — skip (exists)`);
        } else {
          console.error(`  ${ex.name}: insert failed — ${error.message}`);
        }
        continue;
      }
      inserted++;
      continue;
    }

    // Заполняем только пустые поля — не перетираем ручные правки тренера.
    const patch: {
      aliases?: string[];
      technique_ru?: string;
      technique_en?: string;
      description_ru?: string;
      description_en?: string;
      features_ru?: string[];
      features_en?: string[];
    } = {};

    if (!isFilled(row.technique_ru)) patch.technique_ru = ex.techniqueRu;
    if (!isFilled(row.technique_en)) patch.technique_en = ex.techniqueEn;
    if (!isFilled(row.description_ru)) patch.description_ru = ex.descriptionRu;
    if (!isFilled(row.description_en)) patch.description_en = ex.descriptionEn;

    const mergedAliases = Array.from(new Set([...(row.aliases ?? []), ...ex.aliases]));
    if (mergedAliases.length !== (row.aliases ?? []).length) {
      patch.aliases = mergedAliases;
    }
    if (row.features_ru?.length === 0 && ex.featuresRu.length > 0) patch.features_ru = ex.featuresRu;
    if (row.features_en?.length === 0 && ex.featuresEn.length > 0) patch.features_en = ex.featuresEn;

    if (Object.keys(patch).length === 0) {
      untouched++;
      continue;
    }

    const { error } = await supabaseAdmin.from("exercises").update(patch).eq("id", row.id);
    if (error) {
      console.error(`  ${ex.name}: update failed — ${error.message}`);
      continue;
    }
    updated++;
  }

  console.log(
    `Done. Inserted: ${inserted}, updated: ${updated}, untouched: ${untouched} ` +
    `(total seed entries: ${EXERCISES.length})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});