const MS_PER_DAY = 86_400_000;

function parseUTCDate(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00Z`);
}

export function weekdayDateInWeek(
  startDate: string,
  endDate: string | null,
  iso: number,
): string | null {
  if (iso < 1 || iso > 7) return null;

  const start = parseUTCDate(startDate);
  if (isNaN(start.getTime())) return null;

  const end = endDate
    ? parseUTCDate(endDate)
    : new Date(start.getTime() + 6 * MS_PER_DAY);
  if (isNaN(end.getTime()) || end < start) return null;

  let iterations = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    if (++iterations > 7) return null;
    const cursorIso = cursor.getUTCDay() === 0 ? 7 : cursor.getUTCDay();
    if (cursorIso === iso) {
      return cursor.toISOString().slice(0, 10);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return null;
}
