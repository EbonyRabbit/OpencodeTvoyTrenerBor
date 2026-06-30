import type { MyContext } from "../bot.js";
import { findClientByTelegramId } from "../lib/clients.js";

export async function menuHandler(ctx: MyContext): Promise<void> {
  const telegramId = ctx.from?.id;

  if (!telegramId) {
    await ctx.reply("Ошибка: не удалось определить вашего пользователя.");
    return;
  }

  try {
    const client = await findClientByTelegramId(telegramId);

    if (!client) {
      await ctx.reply("Добро пожаловать! Приобретите программу у тренера для начала тренировок.");
      return;
    }

    if (client.status === "access_expired") {
      await ctx.reply("Ваш доступ истёк. Продлите программу у тренера.");
      return;
    }

    if (client.status === "inactive") {
      await ctx.reply("Аккаунт неактивен. Свяжитесь с тренером.");
      return;
    }

    if (client.payment_status === "pending") {
      await ctx.reply("Ожидается подтверждение оплаты.");
      return;
    }

    if (!client.program_id) {
      await ctx.reply("Ожидается назначение программы.");
      return;
    }

    const lines = [
      `Привет, ${client.name ?? "клиент"}!`,
      "",
      "Доступные команды:",
      "/today — тренировка дня",
      "/checkin — чек-ин",
      "/myprogram — моя программа",
      "/settings — настройки",
    ];

    await ctx.reply(lines.join("\n"));
  } catch (err) {
    console.error(`[MENU] Error for ${telegramId}:`, err);
    try {
      await ctx.reply("Сервис временно недоступен. Попробуйте позже.");
    } catch {
      // fallback reply failed
    }
  }
}
