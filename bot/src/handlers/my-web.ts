import type { MyContext } from "../bot.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { config } from "../config.js";
import { t } from "../i18n/index.js";

// ⚠️ MUST stay in sync with web/src/app/clients/[id]/actions.ts
// TODO: Extract to shared lib when monorepo tooling is available
const TOKEN_EXPIRY_DAYS = 30;
const TOKEN_LENGTH = 16;
const TOKEN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function generateToken(length: number): string {
  let token = "";
  while (token.length < length) {
    const byte = crypto.getRandomValues(new Uint8Array(1))[0];
    if (byte < 252) {
      token += TOKEN_CHARS[byte % TOKEN_CHARS.length];
    }
  }
  return token;
}

async function getOrCreateToken(clientId: string): Promise<string | null> {
  const now = new Date().toISOString();

  const { data: existing } = await supabaseAdmin
    .from("client_tokens")
    .select("token")
    .eq("client_id", clientId)
    .gt("expires_at", now)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ token: string }>();

  if (existing?.token) return existing.token;

  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  for (let i = 0; i < 5; i++) {
    const token = generateToken(TOKEN_LENGTH);
    const { error } = await supabaseAdmin
      .from("client_tokens")
      .insert({ client_id: clientId, token, expires_at: expiresAt, last_used_at: null });
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
  const token = await getOrCreateToken(clientId);
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

export async function settingsHandler(ctx: MyContext): Promise<void> {
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

    const url = await buildPortalLink(client.id, "settings");
    if (!url) {
      await ctx.reply(t("myweb.error", ctx.language));
      return;
    }

    await ctx.reply(t("settings.link", ctx.language, { url }));
  } catch (err) {
    console.error(`[SETTINGS] Error for ${ctx.from?.id}:`, err);
    try {
      await ctx.reply(t("error.service_unavailable", ctx.language));
    } catch {
      // fallback reply failed
    }
  }
}
