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
