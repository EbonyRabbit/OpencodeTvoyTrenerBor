export function resolveWorkoutCount(result: {
  data: number | null;
  error: unknown;
}): number | null {
  if (result.error) return null;
  return result.data ?? 0;
}
