export function buildBuyUrl(
  baseUrl: string,
  programId: string,
  buyerTelegramId: number,
  buyerUsername: string | null,
): string {
  const usernameParam = buyerUsername
    ? `&u=${encodeURIComponent(buyerUsername)}`
    : "";
  return `${baseUrl}/buy/${programId}?tg=${buyerTelegramId}${usernameParam}`;
}

export function buildProgramRequestCoachMessage({
  clientName,
  telegramId,
  username,
  programTitle,
}: {
  clientName: string;
  telegramId: number;
  username: string | null;
  programTitle: string;
}): string {
  const tgLink = username ? `https://t.me/${username}` : null;
  const lines = [
    "📩 Запрос от клиента",
    "",
    `👤 ${clientName}`,
    username ? `🔗 @${username} (${tgLink})` : null,
    `🆔 TG ID: ${telegramId}`,
    "",
    `Хочет: ${programTitle}`,
    "",
    "Свяжитесь с клиентом в Telegram.",
  ];
  return lines.filter((line) => line !== null).join("\n");
}