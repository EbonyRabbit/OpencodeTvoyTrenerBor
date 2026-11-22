import type { MyContext } from "../bot.js";
import {
  findClientByTelegramId,
  findClientByConnectCode,
  connectClientToTelegram,
  syncClientName,
  type Client,
} from "../lib/clients.js";
import { hasClientAccess } from "../lib/client-access.js";
import { t, applyClientLanguage } from "../i18n/index.js";
import { InlineKeyboard } from "grammy";
import { runAfterConnect } from "./connect-flow.js";
import { hasCurrentConsent, sendConsentPrompt } from "./consent.js";
import { handleWelcome, WELCOME_PARAMS } from "./welcome.js";

const CODE_REGEX = /^[A-Z0-9]{8}$/;

async function syncClientNameBestEffort(client: Client, username?: string | null): Promise<void> {
  try {
    client.name = await syncClientName(client.id, username, client.name);
  } catch (err) {
    console.warn(`[START] Name sync skipped for ${client.id}:`, err);
  }
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
    const welcomeParam = rawPayload.trim().toLowerCase();
    if (WELCOME_PARAMS.has(welcomeParam)) {
      await handleWelcome(ctx, rawPayload.trim());
      return;
    }
    if (!CODE_REGEX.test(code)) {
      await ctx.reply(t("error.user_not_identified", ctx.language));
      return;
    }

    try {
      const existing = await findClientByTelegramId(telegramId);
      if (existing) {
        await syncClientNameBestEffort(existing, ctx.from?.username);
        ctx.client = existing;
        if (await hasClientAccess(existing)) {
          if (!hasCurrentConsent(existing)) {
            await sendConsentPrompt(ctx);
          } else {
            await runAfterConnect(ctx);
          }
          return;
        }
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
      await syncClientNameBestEffort(client, ctx.from?.username);
      ctx.client = client;

      if (!hasCurrentConsent(client)) {
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
        .text(t("guide.btn_open", ctx.language), "guide:start")
        .row()
        .text(t("coach_request.button", ctx.language), "coach_request");
      await ctx.reply(t("greeting.welcome_new", ctx.language), { reply_markup: keyboard });
      return;
    }

    applyClientLanguage(ctx, client.language);
    await syncClientNameBestEffort(client, ctx.from?.username);
    ctx.client = client;

    if (await hasClientAccess(client)) {
      if (!hasCurrentConsent(client)) {
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
