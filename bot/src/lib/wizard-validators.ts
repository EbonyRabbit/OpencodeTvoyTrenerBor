export function parseSets(input: string): string | null {
  const trimmed = input.trim();
  const num = Number(trimmed);
  if (Number.isInteger(num) && num > 0 && num <= 100) return String(num);
  return null;
}

export function parseReps(input: string): string | null {
  const trimmed = input.trim();

  const rangeMatch = trimmed.match(/^(\d+)\s*[-–/]\s*(\d+)$/);
  if (rangeMatch) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    if (a > 0 && b > 0 && a <= 100 && b <= 100) {
      return `${a}-${b}`;
    }
  }

  const num = Number(trimmed);
  if (Number.isInteger(num) && num > 0 && num <= 100) return String(num);
  return null;
}

export function parseWeight(input: string): string | null {
  const trimmed = input.trim().toLowerCase().replace(/кг|kg/, "").trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!isNaN(num) && num >= 0 && num <= 1000) return String(num);
  return null;
}

export function parseRpe(input: string): string | null {
  const trimmed = input.trim().toLowerCase().replace(/rpe\s*:?\s*|rir\s*:?\s*/g, "").trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (Number.isInteger(num) && num >= 1 && num <= 10) return String(num);
  return null;
}

export function parseMeasurement(input: string): string | null {
  const trimmed = input.trim().toLowerCase().replace(/кг|kg|см|cm/g, "").trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!isNaN(num) && num >= 0 && num <= 300) return String(num);
  return null;
}
