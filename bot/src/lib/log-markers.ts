export const SKIP_MARKER = "[SKIP]";
export const EVENING_PREFIX = "[EVENING_";
export const MORNING_PREFIX = "[MORNING_";
export const MORNING_POSTPONE_MARKER = "[MORNING_POSTPONE]";
export const EVENING_POSTPONE_MARKER = "[EVENING_POSTPONE]";

export const PSEUDO_EXERCISE_RE = /^\[/;

export function isPseudoExercise(exercise: string | null | undefined): boolean {
  return typeof exercise === "string" && PSEUDO_EXERCISE_RE.test(exercise.trim());
}