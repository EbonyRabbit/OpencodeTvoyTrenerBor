export const DEDUP_ERROR_MESSAGE = "Заявка уже отправлена. Тренер скоро свяжется с вами.";

export const TELEGRAM_ID_REGEX = /^\d{5,15}$/;
export const TELEGRAM_USERNAME_REGEX = /^[A-Za-z0-9_]{3,32}$/;

export function parseBuyParams(tgRaw: string, uRaw: string): {
  telegramId: number | null;
  telegramUsername: string | null;
} {
  const tg = typeof tgRaw === "string" ? tgRaw.trim() : "";
  const u = typeof uRaw === "string" ? uRaw.trim() : "";
  const telegramId = TELEGRAM_ID_REGEX.test(tg) ? Number(tg) : null;
  const telegramUsername = TELEGRAM_USERNAME_REGEX.test(u) ? u : null;
  return { telegramId, telegramUsername };
}

export function parseTelegramId(raw: string): number | null {
  const trimmed = String(raw ?? "").trim();
  if (trimmed === "") return null;
  if (!TELEGRAM_ID_REGEX.test(trimmed)) return null;
  return Number(trimmed);
}

export function buildPurchaseCoachMessage({
  programTitle,
  price,
  durationWeeks,
  name,
  contact,
  telegramUsername,
  telegramId,
  formatContact,
  formatPrice,
}: {
  programTitle: string;
  price: number | null;
  durationWeeks: number | null;
  name: string;
  contact: string;
  telegramUsername?: string | null;
  telegramId?: number | null;
  formatContact: (value: string) => string;
  formatPrice: (price: number) => string;
}): string {
  const priceLine = price != null && price > 0 ? `\nЦена: ${formatPrice(price)}` : "";
  const tgLine = telegramId !== null && telegramId !== undefined
    ? `\nTG ID: ${telegramId}`
    : "";
  const contactIsSameUser =
    telegramUsername != null &&
    contact.replace(/^@/, "").toLowerCase() === telegramUsername.toLowerCase();
  const nickLine =
    telegramUsername && !contactIsSameUser
      ? `\n🔗 @${telegramUsername} (https://t.me/${telegramUsername})`
      : "";

  return (
    `🛒 Заявка на покупку\n\nПрограмма: ${programTitle}${priceLine}\n` +
    `Длительность: ${durationWeeks} нед.\n\n👤 Имя: ${name}\n` +
    `📱 Контакт: ${formatContact(contact)}${nickLine}${tgLine}\n\n` +
    `Подтвердите оплату в панели управления.`
  );
}