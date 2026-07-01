import type { MyContext } from "../bot.js";
import { findClientByTelegramId } from "../lib/clients.js";
import type { Client } from "../lib/clients.js";

export interface GuardResult {
  client: Client;
}

export async function guardActiveClient(ctx: MyContext): Promise<GuardResult | string> {
  const telegramId = ctx.from?.id;
  if (!telegramId) {
    return "Ошибка: не удалось определить пользователя.";
  }

  const client = await findClientByTelegramId(telegramId);
  if (!client) {
    return "Сессия истекла. Отправьте /start для начала работы.";
  }

  if (client.status === "access_expired") {
    return "Ваш доступ истёк. Продлите программу у тренера.";
  }

  if (client.status === "inactive") {
    return "Аккаунт неактивен. Свяжитесь с тренером.";
  }

  if (client.payment_status === "pending") {
    return "Ожидается подтверждение оплаты.";
  }

  if (!client.program_id) {
    return "Программа ещё не назначена. Ожидайте — тренер скоро свяжется с вами.";
  }

  return { client };
}
