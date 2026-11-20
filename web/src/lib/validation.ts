export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sanitizeText(value: string): string {
  return value.replace(/[\r\n\t\u0000-\u001F\u007F\u2028\u2029]+/g, " ").trim();
}

const TELEGRAM_USERNAME_REGEX = /^[a-z0-9_]{4,32}$/;
const FALLBACK_NAME_REGEX = /^Клиент #[A-Z0-9]{6}$/;

export function normalizeTelegramUsername(value: string): string | null {
  const normalized = sanitizeText(value).replace(/^@+/, "").toLowerCase();
  if (!TELEGRAM_USERNAME_REGEX.test(normalized)) return null;
  return normalized;
}

export function isValidTelegramUsername(value: string): boolean {
  return normalizeTelegramUsername(value) !== null;
}

export function isValidClientDisplayName(value: string): boolean {
  return value.startsWith("@")
    ? isValidTelegramUsername(value)
    : FALLBACK_NAME_REGEX.test(value);
}

export function telegramDisplayName(username: string | null, seed: string): string {
  const normalized = username ? normalizeTelegramUsername(username) : null;
  if (normalized) return `@${normalized}`;
  const normalizedSeed = seed.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const suffix = (normalizedSeed.slice(-6) || "000000").padStart(6, "0");
  return `Клиент #${suffix}`;
}
