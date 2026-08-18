import type { MyContext } from "../bot.js";
import {
  findClientByTelegramId,
  findClientByConnectCode,
  connectClientToTelegram,
} from "../lib/clients.js";
import { t, applyClientLanguage } from "../i18n/index.js";
import { InlineKeyboard } from "grammy";
import { runAfterConnect } from "./connect-flow.js";
import { sendConsentPrompt } from "./consent.js";

const CODE_REGEX = /^[A-Z0-9]{8}$/;

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

      if (!client.client_consent_given) {
        await sendConsentPrompt(ctx);
      } else {
        await runAfterConnect(ctx);
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
      const keyboard = new InlineKeyboard()
        .text(t("programs.view_button", ctx.language), "programs_open")
        .row()
        .text(t("coach_request.button", ctx.language), "coach_request");
      await ctx.reply(t("greeting.welcome_new", ctx.language), { reply_markup: keyboard });
      return;
    }

    applyClientLanguage(ctx, client.language);

    if (client.status === "active" && client.payment_status === "paid") {
      ctx.client = client;

      if (!client.client_consent_given) {
        await sendConsentPrompt(ctx);
      } else {
        await runAfterConnect(ctx);
      }
      return;
    }

    await ctx.reply(t("client.no_program", ctx.language));
  } catch (err) {
    console.error(`[START] Error handling /start for ${telegramId}:`, err);
    await ctx.reply(t("error.service_unavailable", ctx.language));
  }
}
