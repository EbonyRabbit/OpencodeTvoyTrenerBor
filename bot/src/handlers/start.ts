import type { MyContext } from "../bot.js";
import {
  findClientByTelegramId,
  findClientByConnectCode,
  connectClientToTelegram,
  type Client,
} from "../lib/clients.js";
import { t, applyClientLanguage, type Language } from "../i18n/index.js";
import { startTrainingDaysSetup } from "./training-days.js";

const CODE_REGEX = /^[A-Z0-9]{8}$/;

function buildConnectedMessage(client: Client, lang: Language): string {
  const lines = [t("greeting.hello", lang, { name: client.name ?? t("greeting.default_name", lang) })];

  if (!client.program_id) {
    lines.push(t("client.no_program", lang));
  } else {
    lines.push(t("menu.title", lang));
    lines.push(t("menu.today", lang));
    lines.push(t("menu.myprogram", lang));
  }

  return lines.join("\n");
}

function needsScheduleSetup(client: Client): boolean {
  return !!client.program_id && (client.training_days ?? []).length === 0;
}

export async function startHandler(ctx: MyContext): Promise<void> {
  const telegramId = ctx.from?.id;

  if (!telegramId) {
    await ctx.reply(t("error.user_not_identified", ctx.language));
    return;
  }

  const text = ctx.message?.text ?? "";
  const rawPayload = text.split(" ")[1];
  const code = rawPayload?.trim().toUpperCase() ?? "";

  if (rawPayload) {
    if (!CODE_REGEX.test(code)) {
      await ctx.reply(t("error.user_not_identified", ctx.language));
      return;
    }

    try {
      const existing = await findClientByTelegramId(telegramId);
      if (existing) {
        await ctx.reply(t("client.no_program", ctx.language));
        return;
      }

      const client = await findClientByConnectCode(code);
      if (!client) {
        await ctx.reply(t("client.program_not_found", ctx.language));
        return;
      }

      applyClientLanguage(ctx, client.language);
      await connectClientToTelegram(client.id, telegramId);
      ctx.client = client;
      await ctx.reply(buildConnectedMessage(client, ctx.language));
      if (needsScheduleSetup(client)) {
        await startTrainingDaysSetup(ctx);
      }
    } catch (err) {
      console.error(`[START] Connect error for ${telegramId}:`, err);
      await ctx.reply(t("error.connection_error", ctx.language));
    }
    return;
  }

  try {
    const client = await findClientByTelegramId(telegramId);

    if (!client) {
      await ctx.reply(t("greeting.welcome_new", ctx.language));
      return;
    }

    applyClientLanguage(ctx, client.language);

    if (client.status === "active" && client.payment_status === "paid") {
      ctx.client = client;
      await ctx.reply(buildConnectedMessage(client, ctx.language));
      if (needsScheduleSetup(client)) {
        await startTrainingDaysSetup(ctx);
      }
      return;
    }

    await ctx.reply(t("client.no_program", ctx.language));
  } catch (err) {
    console.error(`[START] Error handling /start for ${telegramId}:`, err);
    await ctx.reply(t("error.service_unavailable", ctx.language));
  }
}
