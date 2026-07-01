import type { MyContext } from "../bot.js";
import { findClientByTelegramId } from "../lib/clients.js";
import type { Client } from "../lib/clients.js";
import { t, applyClientLanguage } from "../i18n/index.js";

export interface GuardResult {
  client: Client;
}

export async function guardActiveClient(ctx: MyContext): Promise<GuardResult | string> {
  const telegramId = ctx.from?.id;
  if (!telegramId) {
    return t("error.user_not_identified", ctx.language);
  }

  const client = await findClientByTelegramId(telegramId);
  if (!client) {
    return t("greeting.session_expired", ctx.language);
  }

  applyClientLanguage(ctx, client.language);

  if (client.status === "access_expired") {
    return t("client.access_expired", ctx.language);
  }

  if (client.status === "inactive") {
    return t("client.inactive", ctx.language);
  }

  if (client.payment_status === "pending") {
    return t("client.payment_pending", ctx.language);
  }

  if (!client.program_id) {
    return t("client.no_program", ctx.language);
  }

  return { client };
}
