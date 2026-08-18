import type { MyContext } from "../bot.js";
import { t, applyClientLanguage } from "../i18n/index.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { config } from "../config.js";
import { buildPaymentUrl } from "../lib/prodamus.js";
import { buildPrivacyUrl, PRIVACY_POLICY_VERSION } from "./consent.js";
import { findClientByTelegramId, type Client } from "../lib/clients.js";
import { truncateButtonLabel } from "./programs.js";
import { InlineKeyboard } from "grammy";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TELEGRAM_BUTTON_MAX_BYTES = 64;

interface BuyableProgram {
  id: string;
  title: string;
  price: number;
}

function formatPrice(price: number): string {
  return `${price.toLocaleString("ru-RU")} ₽`;
}

// contact — обязательное поле purchase_requests: @username, иначе id
function buyerContact(username: string | undefined, telegramId: number): string {
  return username ? `@${username}` : String(telegramId);
}

function buyerName(
  from: { first_name?: string; last_name?: string; username?: string },
  telegramId: number,
): string {
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();
  return name || buyerContact(from.username, telegramId);
}

export function buildPurchaseCoachMessage({
  firstName,
  lastName,
  username,
  telegramId,
  programTitle,
  price,
}: {
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  telegramId: number;
  programTitle: string;
  price: number | null;
}): string {
  const name = [firstName, lastName].filter(Boolean).join(" ").trim() || "—";
  const usernameLine = username ? `🔗 @${username} (https://t.me/${username})` : null;
  const priceLine = price != null && price > 0 ? formatPrice(price) : null;
  const lines = [
    "🛒 Заявка на покупку",
    "",
    `Программа: ${programTitle}`,
    priceLine ? `Цена: ${priceLine}` : null,
    "",
    `👤 ${name}`,
    usernameLine,
    `🆔 TG ID: ${telegramId}`,
    "",
    "Ожидайте оплату или свяжитесь с клиентом.",
  ];
  return lines.filter((line) => line !== null).join("\n");
}

async function fetchBuyableProgram(programId: string): Promise<BuyableProgram | null> {
  const { data } = await supabaseAdmin
    .from("programs")
    .select("id, title, price")
    .eq("id", programId)
    .eq("active", true)
    .eq("type", "template")
    .is("client_id", null)
    .maybeSingle<BuyableProgram>();
  if (!data || data.price === null || data.price <= 0) return null;
  return data as BuyableProgram;
}

async function findPendingRequest(
  telegramId: number,
  programId: string,
): Promise<{ id: string; consent_given: boolean } | null> {
  const { data } = await supabaseAdmin
    .from("purchase_requests")
    .select("id, consent_given")
    .eq("telegram_id", telegramId)
    .eq("program_id", programId)
    .eq("sub_type", "program")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; consent_given: boolean }>();
  return data ?? null;
}

// Кнопка «Купить» в каталоге: создаёт/переиспользует заявку и показывает
// согласие ДО оплаты. Работает и для не-клиентов (без связки в clients):
// доступ к покупке не блокируется guardActiveClient.
export async function startPurchase(ctx: MyContext, programId: string): Promise<void> {
  const from = ctx.from;
  if (!from?.id) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }
  const telegramId = from.id;

  if (!UUID_REGEX.test(programId)) {
    await ctx.answerCallbackQuery({
      text: t("error.unknown_callback", ctx.language),
      show_alert: true,
    }).catch(() => {});
    return;
  }

  await ctx.answerCallbackQuery().catch(() => {});

  let program: BuyableProgram;
  try {
    const fetched = await fetchBuyableProgram(programId);
    if (!fetched) {
      await ctx.reply(t("purchase.not_found", ctx.language));
      return;
    }
    program = fetched;
  } catch (err) {
    console.error(`[PURCHASE] Program fetch failed for ${telegramId}:`, err);
    await ctx.reply(t("purchase.error", ctx.language));
    return;
  }

  let client: Client | null = null;
  try {
    client = await findClientByTelegramId(telegramId);
  } catch (err) {
    console.warn(`[PURCHASE] Client lookup failed for ${telegramId}:`, err);
  }
  if (client) applyClientLanguage(ctx, client.language);
  const lang = ctx.language;

  try {
    const existing = await findPendingRequest(telegramId, program.id);

    if (existing) {
      if (existing.consent_given) {
        await sendPaymentLink(ctx, existing.id, program);
      } else {
        await sendConsentStep(ctx, existing.id, program);
      }
      return;
    }

    const { data: inserted, error } = await supabaseAdmin
      .from("purchase_requests")
      .insert({
        program_id: program.id,
        name: buyerName(from, telegramId),
        contact: buyerContact(from.username, telegramId),
        telegram_id: telegramId,
        first_name: from.first_name ?? null,
        last_name: from.last_name ?? null,
        sub_type: "program",
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !inserted) {
      console.error(`[PURCHASE] Insert failed for ${telegramId}:`, error?.message ?? "no id");
      await ctx.reply(t("purchase.error", lang));
      return;
    }

    await notifyCoachAboutRequest(telegramId, from, program, inserted.id);
    await sendConsentStep(ctx, inserted.id, program);
  } catch (err) {
    console.error(`[PURCHASE] startPurchase failed for ${telegramId}:`, err);
    await ctx.reply(t("purchase.error", lang));
  }
}

// Лучше-чем-ничего уведомление тренеру: заявка уже в БД, поэтому при сбое
// уведомления покупка не блокируется — фиксируем в bot_logs.
async function notifyCoachAboutRequest(
  telegramId: number,
  from: { first_name?: string; last_name?: string; username?: string },
  program: BuyableProgram,
  requestId: string,
): Promise<void> {
  let notificationFailed = false;
  if (config.coachChatId !== 0n) {
    try {
      const bot = (await import("../bot.js")).bot;
      await bot.api.sendMessage(
        String(config.coachChatId),
        buildPurchaseCoachMessage({
          firstName: from.first_name ?? null,
          lastName: from.last_name ?? null,
          username: from.username ?? null,
          telegramId,
          programTitle: program.title,
          price: program.price,
        }),
      );
    } catch (err) {
      console.warn(`[PURCHASE] Coach notification failed for ${telegramId}:`, err);
      notificationFailed = true;
    }
  } else {
    notificationFailed = true;
  }

  const { error: logError } = await supabaseAdmin.from("bot_logs").insert({
    action: notificationFailed ? "purchase_request:coach_notification_failed" : "purchase_request",
    status: notificationFailed ? "error" : "info",
    telegram_id: telegramId,
    details: JSON.stringify({
      purchase_request_id: requestId,
      program_id: program.id,
      program_title: program.title,
    }),
  });
  if (logError) {
    console.warn(`[PURCHASE] Failed to log request for ${telegramId}:`, logError.message);
  }
}

function sendConsentStep(
  ctx: MyContext,
  requestId: string,
  program: BuyableProgram,
): Promise<unknown> {
  const lang = ctx.language;
  const text = [
    t("client.consent_title", lang),
    "",
    t("purchase.policy", lang, {
      title: program.title,
      price: formatPrice(program.price),
      privacyUrl: buildPrivacyUrl(),
    }),
    "",
    t("client.consent_required", lang),
  ].join("\n");
  const keyboard = new InlineKeyboard().text(
    t("purchase.consent_button", lang),
    `consent_purchase:${requestId}`,
  );
  return ctx.reply(text, { reply_markup: keyboard });
}

// Подтверждение согласия ДО оплаты: проставляет consent в заявке
// и выдаёт ссылку на платёжную страницу Продамуса.
export async function handleConsentPurchase(ctx: MyContext, requestId: string): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  if (!UUID_REGEX.test(requestId)) {
    await ctx.answerCallbackQuery({
      text: t("error.unknown_callback", ctx.language),
      show_alert: true,
    }).catch(() => {});
    return;
  }

  await ctx.answerCallbackQuery().catch(() => {});

  const lang = ctx.language;

  try {
    const { data: request, error: fetchError } = await supabaseAdmin
      .from("purchase_requests")
      .select("id, program_id, status, consent_given, sub_type, telegram_id")
      .eq("id", requestId)
      .maybeSingle<{
        id: string;
        program_id: string | null;
        status: string;
        consent_given: boolean;
        sub_type: string;
        telegram_id: number | null;
      }>();
    if (fetchError || !request) {
      console.error(`[PURCHASE] Request fetch failed for ${telegramId}:`, fetchError?.message);
      await ctx.reply(t("purchase.invalid_request", lang));
      return;
    }
    // согласие и оплату даёт только автор заявки (заявки из веб-формы не
    // подтверждаются по кнопке из Telegram)
    if (request.telegram_id !== telegramId) {
      await ctx.reply(t("purchase.invalid_request", lang));
      return;
    }
    if (request.status === "paid") {
      await ctx.reply(t("purchase.already_paid", lang));
      return;
    }
    if (!request.program_id || request.sub_type !== "program") {
      await ctx.reply(t("purchase.invalid_request", lang));
      return;
    }

    if (!request.consent_given) {
      const { error: updateError } = await supabaseAdmin
        .from("purchase_requests")
        .update({
          consent_given: true,
          consent_at: new Date().toISOString(),
          consent_version: PRIVACY_POLICY_VERSION,
        })
        .eq("id", requestId)
        .eq("consent_given", false);
      if (updateError) {
        console.error(`[PURCHASE] Consent update failed for ${telegramId}:`, updateError.message);
        await ctx.reply(t("purchase.error", lang));
        return;
      }
    }

    const program = await fetchBuyableProgram(request.program_id);
    if (!program) {
      await ctx.reply(t("purchase.not_found", lang));
      return;
    }

    await sendPaymentLink(ctx, requestId, program);
  } catch (err) {
    console.error(`[PURCHASE] handleConsentPurchase failed for ${telegramId}:`, err);
    await ctx.reply(t("purchase.error", lang));
  }
}

async function sendPaymentLink(
  ctx: MyContext,
  requestId: string,
  program: BuyableProgram,
): Promise<void> {
  const lang = ctx.language;
  if (!config.prodamusPayformBaseUrl) {
    console.error("[PURCHASE] PRODAMUS_PAYFORM_BASE_URL is not set");
    await ctx.reply(t("purchase.payment_unavailable", lang));
    return;
  }
  try {
    const paymentUrl = buildPaymentUrl({
      payformUrl: config.prodamusPayformBaseUrl,
      orderId: requestId,
      amount: program.price,
      productName: program.title,
    });
    const payLabel = truncateButtonLabel(
      t("purchase.pay_button", lang, {
        title: program.title,
        price: formatPrice(program.price),
      }),
      TELEGRAM_BUTTON_MAX_BYTES,
    );
    const keyboard = new InlineKeyboard().url(payLabel, paymentUrl);
    await ctx.reply(
      `${t("purchase.consent_given", lang)}\n\n${t("purchase.pay_hint", lang)}`,
      { reply_markup: keyboard },
    );
  } catch (err) {
    console.error(`[PURCHASE] buildPaymentUrl failed for ${ctx.from?.id}:`, err);
    await ctx.reply(t("purchase.error", lang));
  }
}
