const RU_DAY_NAME_TO_ISO: Record<string, number> = {
  понедельник: 1,
  вторник: 2,
  среда: 3,
  четверг: 4,
  пятница: 5,
  суббота: 6,
  воскресенье: 7,
};

export function normalizeName(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function weekdayIsoFromName(dayName: string): number {
  const normalized = normalizeName(dayName);
  if (!normalized) return 0;
  const exact = RU_DAY_NAME_TO_ISO[normalized];
  if (exact) return exact;
  for (const [name, iso] of Object.entries(RU_DAY_NAME_TO_ISO)) {
    if (normalized.includes(name)) return iso;
  }
  return 0;
}