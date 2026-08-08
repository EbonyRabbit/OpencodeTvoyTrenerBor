import type { MyContext } from "../bot.js";
import { t, applyClientLanguage, type Language } from "../i18n/index.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { config } from "../config.js";
import { InlineKeyboard, GrammyError } from "grammy";
import { runAfterConnect } from "./connect-flow.js";

// ⚠️ MUST stay in sync with web/src/lib/consent.ts (portal shows the version it records)
export const PRIVACY_POLICY_VERSION = "2026-07-16";

const PRIVACY_URL_FALLBACK = "https://твой-тренер.ру/privacy";

export function buildPrivacyUrl(): string {
  return config.clientPortalUrl ? `${config.clientPortalUrl}/privacy` : PRIVACY_URL_FALLBACK;
}

export function buildConsentMessage(lang: Language): string {
  return [
    t("client.consent_title", lang),
    "",
    t("client.consent_text", lang, { privacyUrl: buildPrivacyUrl() }),
  ].join("\n");
}

export function buildConsentKeyboard(lang: Language): InlineKeyboard {
  return new InlineKeyboard().text(
    t("client.consent_accept", lang),
    "consent_accept",
  );
}

export async function sendConsentPrompt(ctx: MyContext): Promise<void> {
  await ctx.reply(
    `${buildConsentMessage(ctx.language)}\n\n${t("client.consent_required", ctx.language)}`,
    { reply_markup: buildConsentKeyboard(ctx.language) },
  );
}

export async function handleConsentAccept(ctx: MyContext): Promise<void> {
  if (!ctx.from?.id) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  await ctx.answerCallbackQuery().catch(() => {});

  const clientId = ctx.client?.id;
  if (!clientId) {
    const { findClientByTelegramId } = await import("../lib/clients.js");
    const client = await findClientByTelegramId(ctx.from.id);
    if (!client) {
      await ctx.answerCallbackQuery({
        text: t("error.user_not_identified", ctx.language),
        show_alert: true,
      }).catch(() => {});
      return;
    }
    ctx.client = client;
  }

  const client = ctx.client;
  if (!client) return;

  applyClientLanguage(ctx, client.language);

  if (client.client_consent_given) {
    await sendAcceptedReply(ctx);
    return;
  }

  const { error } = await supabaseAdmin
    .from("clients")
    .update({
      client_consent_given: true,
      client_consent_given_at: new Date().toISOString(),
      client_consent_ip: null,
      client_consent_user_agent: null,
      client_consent_version: PRIVACY_POLICY_VERSION,
    })
    .eq("id", client.id);

  if (error) {
    console.error(`[CONSENT] Update error for ${ctx.from.id}:`, error.message);
    await ctx.reply(t("error.service_unavailable", ctx.language));
    return;
  }

  client.client_consent_given = true;
  await sendAcceptedReply(ctx);
  await runAfterConnect(ctx);
}

async function sendAcceptedReply(ctx: MyContext): Promise<void> {
  const text = [t("client.consent_title", ctx.language), "", t("client.consent_accepted", ctx.language)].join("\n");
  try {
    await ctx.editMessageText(text);
  } catch (err) {
    if (err instanceof GrammyError && err.error_code === 400 && err.description?.includes("message is not modified")) {
      return;
    }
    console.error(`[CONSENT] editMessageText failed for ${ctx.from?.id}:`, err);
    await ctx.reply(t("client.consent_accepted", ctx.language)).catch(() => {});
  }
}