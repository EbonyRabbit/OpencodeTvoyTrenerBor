import type { MyContext } from "../bot.js";
import { findClientByTelegramId, type Client } from "../lib/clients.js";

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
  const payload = text.split(" ")[1];

  if (payload) {
    // TODO: implement connect-by-code logic in task 2.4
    await ctx.reply(`Получен код: ${payload}. Подключение будет доступно позже.`);
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
