export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sanitizeText(value: string): string {
  return value.replace(/[\r\n\t\u0000-\u001F\u007F\u2028\u2029]+/g, " ").trim();
}

const TELEGRAM_USERNAME_REGEX = /^[A-Za-z0-9_]{3,32}$/;
const PHONE_REGEX = /^\+?\d[\d\s()-]{6,19}$/;

export function isValidContact(value: string): boolean {
  return TELEGRAM_USERNAME_REGEX.test(value) || PHONE_REGEX.test(value);
}

export function formatContact(value: string): string {
  return /^\+?\d/.test(value) ? value : `@${value}`;
}
