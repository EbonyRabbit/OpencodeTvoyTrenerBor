import type { MyContext } from "../bot.js";
import { findClientByTelegramId } from "../lib/clients.js";
import type { Client } from "../lib/clients.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { t, applyClientLanguage } from "../i18n/index.js";

export interface GuardResult {
  client: Client;
}

/**
 * Ленивое автоистечение доступа (21.10): активный клиент с прошедшим
 * access_end_date помечается status='access_expired'. Условный UPDATE
 * (eq status=active + lt access_end_date) делает операцию идемпотентной:
 * гонки с продлением доступа не перезапишут свежие даты.
 */
async function lazyExpireAccess(client: Client): Promise<boolean> {
  if (client.status !== "active" || !client.access_end_date) return false;
  if (new Date(client.access_end_date).getTime() >= Date.now()) return false;

  // Активная пауза — доступ не истекает во время паузы.
  const { data: pause } = await supabaseAdmin
    .from("plan_pauses")
    .select("id")
    .eq("client_id", client.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (pause) return false;

  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("clients")
    .update({ status: "access_expired" })
    .eq("id", client.id)
    .eq("status", "active")
    .lt("access_end_date", nowIso)
    .select("id");
  if (error) {
    console.error("[GUARD] Failed to expire access:", error.message);
    return false;
  }
  // 0 строк = дату успели продлить в гонке — доступ остаётся активным.
  return Array.isArray(data) && data.length > 0;
}

async function baseGuard(ctx: MyContext, requireProgram: boolean): Promise<GuardResult | string> {
  const telegramId = ctx.from?.id;
  if (!telegramId) {
    return t("error.user_not_identified", ctx.language);
  }

  const client = await findClientByTelegramId(telegramId);
  if (!client) {
    return t("greeting.session_expired", ctx.language);
  }

  applyClientLanguage(ctx, client.language);

  if (await lazyExpireAccess(client)) {
    return t("client.access_expired", ctx.language);
  }

  // Fallback для клиентов, истёкших до внедрения ленивого автоистечения.
  if (client.status === "access_expired") {
    return t("client.access_expired", ctx.language);
  }

  if (client.status === "inactive") {
    return t("client.inactive", ctx.language);
  }

  if (client.payment_status === "pending") {
    return t("client.payment_pending", ctx.language);
  }

  if (requireProgram && !client.program_id) {
    return t("client.no_program", ctx.language);
  }

  return { client };
}

export async function guardActiveClient(ctx: MyContext): Promise<GuardResult | string> {
  return baseGuard(ctx, true);
}

export async function guardAuthenticatedClient(ctx: MyContext): Promise<GuardResult | string> {
  return baseGuard(ctx, false);
}
