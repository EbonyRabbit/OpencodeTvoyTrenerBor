export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: String(chatId), text }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
