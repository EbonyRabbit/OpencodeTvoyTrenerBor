// ⚠️ MUST stay in sync with bot/src/lib/exercise-groups.ts (те же 14 групп).
export const EXERCISE_GROUPS = [
  "Грудь",
  "Спина",
  "Ноги",
  "Ягодицы",
  "Плечи",
  "Бицепс",
  "Трицепс",
  "Кор",
  "Икры",
  "Предплечья",
  "Приводящие",
  "Голеностоп",
  "Кардио",
  "Взрывная работа",
] as const;

export type ExerciseGroup = (typeof EXERCISE_GROUPS)[number];

export function isExerciseGroup(value: string): value is ExerciseGroup {
  return (EXERCISE_GROUPS as readonly string[]).includes(value);
}

/** Каноническое написание группы без учёта регистра; null для неизвестного значения. */
export function toExerciseGroup(value: string): ExerciseGroup | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return EXERCISE_GROUPS.find((group) => group.toLowerCase() === normalized) ?? null;
}
