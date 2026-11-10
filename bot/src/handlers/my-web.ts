import type { MyContext } from "../bot.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { config } from "../config.js";
import { t } from "../i18n/index.js";
import {
  CLIENT_TOKEN_EXPIRY_DAYS,
  generateClientTokenValue,
  hashClientToken,
} from "../lib/client-token.js";

async function createToken(clientId: string): Promise<string | null> {
  const expiresAt = new Date(
    Date.now() + CLIENT_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  for (let i = 0; i < 5; i++) {
    const token = generateClientTokenValue();
    const { error } = await supabaseAdmin.rpc("create_client_token", {
      p_client_id: clientId,
      p_token_hash: hashClientToken(token),
      p_expires_at: expiresAt,
    });
    if (!error) return token;
    if (error.code !== "23505") return null;
  }

  return null;
}

export async function buildPortalLink(
  clientId: string,
  section?: string,
): Promise<string | null> {
  if (!config.clientPortalUrl) return null;
  const token = await createToken(clientId);
  if (!token) return null;
  return `${config.clientPortalUrl}/client/${token}${section ? `/${section}` : ""}`;
}

export async function myWebHandler(ctx: MyContext): Promise<void> {
  try {
    const client = ctx.client;
    if (!client) {
      await ctx.reply(t("greeting.session_expired", ctx.language));
      return;
    }

    if (!config.clientPortalUrl) {
      await ctx.reply(t("myweb.no_portal_url", ctx.language));
      return;
    }

    const url = await buildPortalLink(client.id);
    if (!url) {
      await ctx.reply(t("myweb.error", ctx.language));
      return;
    }

    await ctx.reply(t("myweb.link", ctx.language, { url }));
  } catch (err) {
    console.error(`[MYWEB] Error for ${ctx.from?.id}:`, err);
    try {
      await ctx.reply(t("error.service_unavailable", ctx.language));
    } catch {
      // fallback reply failed
    }
  }
}
