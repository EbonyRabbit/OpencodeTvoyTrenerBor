import type { MyContext } from "../bot.js";
import {
  findClientByTelegramId,
  findClientByConnectCode,
  connectClientToTelegram,
  type Client,
} from "../lib/clients.js";

const CODE_REGEX = /^[A-Z0-9]{8}$/;

function buildMenuMessage(client: Client): string {
  const lines = [`Привет, ${client.name}!`];

  if (!client.program_id) {
    lines.push("Ожидается назначение программы.");
  } else {
    lines.push("Вы подключены. Используйте /menu для навигации.");
  }

  return lines.join("\n");
}

function buildConnectMessage(): string {
  return [
    "Подключите аккаунт к боту.",
    "Отправьте /start <код> — код подключения от вашего тренера.",
    "Если у вас нет кода, свяжитесь с тренером.",
  ].join("\n");
}

function buildNewUserMessage(): string {
  return [
    "Добро пожаловать!",
    "Чтобы начать тренировки с ботом, приобретите программу у тренера.",
    "После оплаты вы получите код подключения.",
  ].join("\n");
}

export async function startHandler(ctx: MyContext): Promise<void> {
  const telegramId = ctx.from?.id;

  if (!telegramId) {
    await ctx.reply("Ошибка: не удалось определить вашего пользователя.");
    return;
  }

  const text = ctx.message?.text ?? "";
  const rawPayload = text.split(" ")[1];
  const code = rawPayload?.trim().toUpperCase() ?? "";

  if (rawPayload) {
    if (!CODE_REGEX.test(code)) {
      await ctx.reply("Неверный формат кода. Код должен содержать 8 символов (буквы и цифры).");
      return;
    }

    try {
      const existing = await findClientByTelegramId(telegramId);
      if (existing) {
        await ctx.reply("Ваш аккаунт уже подключён. Используйте /menu.");
        return;
      }

      const client = await findClientByConnectCode(code);
      if (!client) {
        await ctx.reply("Код не найден. Проверьте код или обратитесь к тренеру.");
        return;
      }

      await connectClientToTelegram(client.id, telegramId);
      await ctx.reply(buildMenuMessage(client));
    } catch (err) {
      console.error(`[START] Connect error for ${telegramId}:`, err);
      await ctx.reply("Ошибка подключения. Попробуйте позже.");
    }
    return;
  }

  try {
    const client = await findClientByTelegramId(telegramId);

    if (!client) {
      await ctx.reply(buildNewUserMessage());
      return;
    }

    if (client.status === "active" && client.payment_status === "paid") {
      await ctx.reply(buildMenuMessage(client));
      return;
    }

    await ctx.reply(buildConnectMessage());
  } catch (err) {
    console.error(`[START] Error handling /start for ${telegramId}:`, err);
    await ctx.reply("Сервис временно недоступен. Попробуйте позже.");
  }
}
