import { randomUUID } from "node:crypto";
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
// лёгкий антиспам: не больше активных pending-заявок на пользователя
const MAX_PENDING_REQUESTS = 3;

interface BuyableProgram {
  id: string;
  title: string;
  price: number;
}

interface ProgramRequest {
  id: string;
  status: string;
  consent_given: boolean;
  amount: number | null;
}

function requestAmount(request: ProgramRequest, program: BuyableProgram): number {
  return request.amount != null && request.amount > 0 ? request.amount : program.price;
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

// Последняя заявка пользователя по этой программе (любой статус):
// paid-заявка не даёт платить повторно, cancelled позволяет новую покупку.
async function findRequestForProgram(
  telegramId: number,
  programId: string,
): Promise<ProgramRequest | null> {
  const { data } = await supabaseAdmin
    .from("purchase_requests")
    .select("id, status, consent_given, amount")
    .eq("telegram_id", telegramId)
    .eq("program_id", programId)
    .eq("sub_type", "program")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ProgramRequest>();
  return data ?? null;
}

async function countPendingRequests(telegramId: number): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("purchase_requests")
    .select("id", { count: "exact", head: true })
    .eq("telegram_id", telegramId)
    .eq("sub_type", "program")
    .eq("status", "pending");
  if (error) {
    // fail-closed: ошибка счётчика не должна обходить антиспам
    throw new Error(`Pending count failed: ${error.message}`);
  }
  return count ?? 0;
}

type PriorPaymentCheck =
  | { ok: true }
  | { ok: false; reason: "error" | "owned" | "paid" };

// Защита от повторной оплаты на пути выдачи ссылки: программа уже выдана
// клиенту (clients.program_id) или оплачена по другой заявке (ведётся
// тренером в панели). Fail-closed: ошибка запроса трактуется как «отказать».
async function assertNoPriorPayment(
  telegramId: number,
  programId: string,
): Promise<PriorPaymentCheck> {
  let client: Client | null = null;
  try {
    client = await findClientByTelegramId(telegramId);
  } catch (err) {
    console.error(`[PURCHASE] Client lookup failed for ${telegramId}:`, err);
    return { ok: false, reason: "error" };
  }
  if (client?.program_id === programId) {
    return { ok: false, reason: "owned" };
  }
  const { data: paidRequest, error } = await supabaseAdmin
    .from("purchase_requests")
    .select("id")
    .eq("telegram_id", telegramId)
    .eq("program_id", programId)
    .eq("status", "paid")
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (error) {
    console.error(`[PURCHASE] Paid-request check failed for ${telegramId}:`, error.message);
    return { ok: false, reason: "error" };
  }
  if (paidRequest) {
    return { ok: false, reason: "paid" };
  }
  return { ok: true };
}

// Возвращает false, если блокировка уже отправлена пользователю.
async function ensureNoPriorPayment(
  ctx: MyContext,
  telegramId: number,
  programId: string,
  lang: MyContext["language"],
): Promise<boolean> {
  const check = await assertNoPriorPayment(telegramId, programId);
  if (check.ok) return true;
  if (check.reason === "paid") {
    await ctx.reply(t("purchase.already_paid", lang));
  } else if (check.reason === "owned") {
    await ctx.reply(t("purchase.already_owned", lang));
  } else {
    await ctx.reply(t("purchase.error", lang));
  }
  return false;
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
    // fail-closed: без проверки владения нельзя открывать ни согласие, ни ссылку
    console.error(`[PURCHASE] Client lookup failed for ${telegramId}:`, err);
    await ctx.reply(t("purchase.error", ctx.language));
    return;
  }
  if (client) applyClientLanguage(ctx, client.language);
  const lang = ctx.language;

  // уже владеет программой (активирована после оплаты) — повторная оплата не нужна
  if (client && client.program_id === program.id) {
    await ctx.reply(t("purchase.already_owned", lang));
    return;
  }

  try {
    const latest = await findRequestForProgram(telegramId, program.id);
    if (latest) {
      if (latest.status === "paid") {
        await ctx.reply(t("purchase.already_paid", lang));
        return;
      }
      if (latest.status === "pending") {
        if (latest.consent_given) {
          // ссылка выдаётся напрямую — та же защита от повторной оплаты,
          // что и в consent-пути
          if (!(await ensureNoPriorPayment(ctx, telegramId, program.id, lang))) {
            return;
          }
          await sendPaymentLink(ctx, latest.id, program, requestAmount(latest, program));
        } else {
          await sendConsentStep(ctx, latest.id, program, requestAmount(latest, program));
        }
        return;
      }
      // cancelled (отменена коучем) — можно покупать заново
    }

    if ((await countPendingRequests(telegramId)) >= MAX_PENDING_REQUESTS) {
      await ctx.reply(t("purchase.too_many", lang));
      return;
    }

    // order_id = id заявки (как задумано в миграции); amount — снимок цены
    // на момент покупки, по нему вебхук Продамуса сверит фактическое списание.
    const requestId = randomUUID();
    const requestPayload = {
      id: requestId,
      order_id: requestId,
      amount: program.price,
      client_id: client?.id ?? null,
      program_id: program.id,
      name: buyerName(from, telegramId),
      contact: buyerContact(from.username, telegramId),
      telegram_id: telegramId,
      first_name: from.first_name ?? null,
      last_name: from.last_name ?? null,
      sub_type: "program",
    };
    const insertRequest = async () =>
      supabaseAdmin.from("purchase_requests").insert(requestPayload);

    let { error } = await insertRequest();

    if (error?.code === "23505") {
      // гонка двойного тапа: параллельная вставка победила — переиспользуем её
      const winner = await findRequestForProgram(telegramId, program.id).catch(() => null);
      if (winner?.status === "paid") {
        await ctx.reply(t("purchase.already_paid", lang));
        return;
      }
      if (winner?.status === "pending") {
        if (winner.consent_given) {
          if (!(await ensureNoPriorPayment(ctx, telegramId, program.id, lang))) {
            return;
          }
          await sendPaymentLink(ctx, winner.id, program, requestAmount(winner, program));
        } else {
          await sendConsentStep(ctx, winner.id, program, requestAmount(winner, program));
        }
        return;
      }
      // winner пропал или отменён (гонка отмен тренером) — повторяем вставку
      error = (await insertRequest()).error;
    }

    if (error) {
      console.error(`[PURCHASE] Insert failed for ${telegramId}:`, error.message);
      await ctx.reply(t("purchase.error", lang));
      return;
    }

    await notifyCoachAboutRequest(telegramId, from, program, requestId);
    await sendConsentStep(ctx, requestId, program, program.price);
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
  amount: number,
): Promise<unknown> {
  const lang = ctx.language;
  const text = [
    t("client.consent_title", lang),
    "",
    t("purchase.policy", lang, {
      title: program.title,
      price: formatPrice(amount),
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
      .select("id, program_id, status, consent_given, sub_type, telegram_id, amount")
      .eq("id", requestId)
      .maybeSingle<{
        id: string;
        program_id: string | null;
        status: string;
        consent_given: boolean;
        sub_type: string;
        telegram_id: number | null;
        amount: number | null;
      }>();
    if (fetchError || !request) {
      console.error(`[PURCHASE] Request fetch failed for ${telegramId}:`, fetchError?.message);
      await ctx.reply(t("purchase.invalid_request", lang));
      return;
    }
    // согласие и оплату даёт только автор заявки (заявки из веб-формы не
    // подтверждаются по кнопке из Telegram)
    if (request.telegram_id !== telegramId || request.sub_type !== "program") {
      await ctx.reply(t("purchase.invalid_request", lang));
      return;
    }
    if (request.status === "paid") {
      await ctx.reply(t("purchase.already_paid", lang));
      return;
    }
    // отменённая коучем заявка не должна оживать по старой кнопке
    if (request.status !== "pending") {
      await ctx.reply(t("purchase.invalid_request", lang));
      return;
    }
    if (!request.program_id) {
      await ctx.reply(t("purchase.invalid_request", lang));
      return;
    }

    // сначала проверяем, что программа всё ещё продаётся (согласие
    // записываем только для реальной покупки)
    const program = await fetchBuyableProgram(request.program_id);
    if (!program) {
      await ctx.reply(t("purchase.not_found", lang));
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
        .eq("telegram_id", telegramId)
        .eq("status", "pending")
        .eq("consent_given", false);
      if (updateError) {
        console.error(`[PURCHASE] Consent update failed for ${telegramId}:`, updateError.message);
        await ctx.reply(t("purchase.error", lang));
        return;
      }
      // 0 затронутых строк не блокируем: двойной тап уже проставил согласие,
      // а если статус изменился — это поймает финальная проверка ниже
    }

    // финальная проверка ПЕРЕД выдачей ссылки: статус и согласие могли
    // измениться между чтением и записью (TOCTOU)
    const { data: fresh, error: refreshError } = await supabaseAdmin
      .from("purchase_requests")
      .select("id, status, consent_given, amount")
      .eq("id", requestId)
      .maybeSingle<{
        id: string;
        status: string;
        consent_given: boolean;
        amount: number | null;
      }>();
    if (refreshError || !fresh || fresh.status !== "pending" || !fresh.consent_given) {
      if (fresh?.status === "paid") {
        await ctx.reply(t("purchase.already_paid", lang));
        return;
      }
      await ctx.reply(t("purchase.invalid_request", lang));
      return;
    }

    // защита от повторной оплаты: программа уже выдана клиенту или
    // уже оплачена по другой заявке (панельные действия тренера);
    // fail-closed: ошибка запроса блокирует выдачу ссылки
    if (!(await ensureNoPriorPayment(ctx, telegramId, request.program_id, lang))) {
      return;
    }

    await sendPaymentLink(ctx, requestId, program, requestAmount(fresh, program));
  } catch (err) {
    console.error(`[PURCHASE] handleConsentPurchase failed for ${telegramId}:`, err);
    await ctx.reply(t("purchase.error", lang));
  }
}

async function sendPaymentLink(
  ctx: MyContext,
  requestId: string,
  program: BuyableProgram,
  amount: number,
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
      amount,
      productName: program.title,
    });
    const payLabel = truncateButtonLabel(
      t("purchase.pay_button", lang, {
        title: program.title,
        price: formatPrice(amount),
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

// ─────────────────────────────────────────────────────────────────────────────
// Заявка «Связаться с тренером» (sub_type='individ'): согласие получаем ДО
// вставки (для не-клиентов единственное хранилище согласия — строка заявки),
// поэтому кнопка подтверждения и создаёт заявку сразу с consent_given=true.
// ─────────────────────────────────────────────────────────────────────────────

export function buildCoachRequestCoachMessage({
  firstName,
  lastName,
  username,
  telegramId,
}: {
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  telegramId: number;
}): string {
  const name = [firstName, lastName].filter(Boolean).join(" ").trim() || "—";
  const usernameLine = username ? `🔗 @${username} (https://t.me/${username})` : null;
  const lines = [
    "🤝 Хочу индивидуальное ведение/кураторство",
    "",
    `👤 ${name}`,
    usernameLine,
    `🆔 TG ID: ${telegramId}`,
    "",
    "Свяжитесь с клиентом в Telegram.",
  ];
  return lines.filter((line) => line !== null).join("\n");
}

// Соло-лимит: у пользователя может быть только одна активная individ-заявка
// (уникальный индекс purchase_requests_unique_pending_individ_per_user).
async function findPendingIndividRequest(telegramId: number): Promise<{ id: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("purchase_requests")
    .select("id")
    .eq("telegram_id", telegramId)
    .eq("sub_type", "individ")
    .eq("status", "pending")
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (error) {
    // fail-closed: если нельзя проверить отсутствие заявки — заявку не создаём
    throw new Error(`Pending individ check failed: ${error.message}`);
  }
  return data ?? null;
}

function sendCoachRequestConsentStep(ctx: MyContext): Promise<unknown> {
  const lang = ctx.language;
  const text = [
    t("client.consent_title", lang),
    "",
    t("coach_request.policy", lang, { privacyUrl: buildPrivacyUrl() }),
    "",
    t("client.consent_required", lang),
  ].join("\n");
  const keyboard = new InlineKeyboard().text(
    t("purchase.consent_button", lang),
    "coach_request:consent",
  );
  return ctx.reply(text, { reply_markup: keyboard });
}

async function submitIndividRequest(
  ctx: MyContext,
  from: { id: number; first_name?: string; last_name?: string; username?: string },
  client: Client | null,
): Promise<void> {
  const telegramId = from.id;
  const lang = ctx.language;

  try {
    if (await findPendingIndividRequest(telegramId)) {
      await ctx.reply(t("coach_request.already_sent", lang));
      return;
    }

    // согласие фиксируется атомарно при создании заявки: у не-клиентов другого
    // хранилища согласия нет (clients-строка отсутствует). Для клиента берём
    // его постоянное согласие только если оно действует под текущей версией
    // политики, иначе фиксируем свежее (пользователь только что видел политику).
    const standingConsent =
      client != null &&
      client.client_consent_given &&
      client.client_consent_version === PRIVACY_POLICY_VERSION;

    const requestId = randomUUID();
    const payload = {
      id: requestId,
      program_id: null,
      client_id: client?.id ?? null,
      name: buyerName(from, telegramId),
      contact: buyerContact(from.username, telegramId),
      telegram_id: telegramId,
      first_name: from.first_name ?? null,
      last_name: from.last_name ?? null,
      sub_type: "individ",
      consent_given: true,
      consent_at: standingConsent && client.client_consent_given_at
        ? client.client_consent_given_at
        : new Date().toISOString(),
      consent_version: standingConsent ? client.client_consent_version : PRIVACY_POLICY_VERSION,
    };
    const insert = async () => supabaseAdmin.from("purchase_requests").insert(payload);

    let { error } = await insert();
    if (error?.code === "23505") {
      // гонка двойного тапа: параллельная заявка победила
      const winner = await findPendingIndividRequest(telegramId).catch(() => null);
      if (winner) {
        await ctx.reply(t("coach_request.already_sent", lang));
        return;
      }
      // winner пропал (гонка отмен тренером) — повторяем вставку один раз
      error = (await insert()).error;
    }
    if (error) {
      console.error(`[COACH_REQUEST] Insert failed for ${telegramId}:`, error.message);
      await ctx.reply(t("coach_request.error", lang));
      return;
    }

    await notifyCoachAboutIndividRequest(telegramId, from, requestId);
    await ctx.reply(t("coach_request.sent", lang));
  } catch (err) {
    console.error(`[COACH_REQUEST] submitIndividRequest failed for ${telegramId}:`, err);
    await ctx.reply(t("coach_request.error", lang));
  }
}

// Уведомление тренеру, как notifyCoachAboutRequest: не блокирует клиента
// при сбое — заявка уже в БД и видна в панели (фиксируем в bot_logs).
async function notifyCoachAboutIndividRequest(
  telegramId: number,
  from: { first_name?: string; last_name?: string; username?: string },
  requestId: string,
): Promise<void> {
  let notificationFailed = false;
  if (config.coachChatId !== 0n) {
    try {
      const bot = (await import("../bot.js")).bot;
      await bot.api.sendMessage(
        String(config.coachChatId),
        buildCoachRequestCoachMessage({
          firstName: from.first_name ?? null,
          lastName: from.last_name ?? null,
          username: from.username ?? null,
          telegramId,
        }),
      );
    } catch (err) {
      console.warn(`[COACH_REQUEST] Coach notification failed for ${telegramId}:`, err);
      notificationFailed = true;
    }
  } else {
    notificationFailed = true;
  }

  try {
    const { error: logError } = await supabaseAdmin.from("bot_logs").insert({
      action: notificationFailed ? "coach_request:coach_notification_failed" : "coach_request",
      status: notificationFailed ? "error" : "info",
      telegram_id: telegramId,
      details: JSON.stringify({ purchase_request_id: requestId, sub_type: "individ" }),
    });
    if (logError) {
      console.warn(`[COACH_REQUEST] Failed to log request for ${telegramId}:`, logError.message);
    }
  } catch (err) {
    // лог не должен ломать контракт «не блокируем клиента»: rejection сети
    // здесь не должна превращаться в ошибку «не удалось отправить»
    console.warn(`[COACH_REQUEST] Failed to log request for ${telegramId}:`, err);
  }
}

type ClientLookupResult = { ok: true; client: Client | null } | { ok: false };

async function findClientOrFail(
  ctx: MyContext,
  telegramId: number,
): Promise<ClientLookupResult> {
  try {
    const client = await findClientByTelegramId(telegramId);
    if (client) applyClientLanguage(ctx, client.language);
    return { ok: true, client };
  } catch (err) {
    // fail-closed: без проверки нельзя решить, нужен ли шаг согласия
    console.error(`[COACH_REQUEST] Client lookup failed for ${telegramId}:`, err);
    await ctx.reply(t("coach_request.error", ctx.language));
    return { ok: false };
  }
}

// Кнопка «Связаться с тренером»: доступна и новым пользователям (без clients),
// и активным клиентам, поэтому живёт в pre-guard ветке bot.ts.
export async function startCoachRequest(ctx: MyContext): Promise<void> {
  const from = ctx.from;
  if (!from?.id) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }
  const telegramId = from.id;
  await ctx.answerCallbackQuery().catch(() => {});

  const lookup = await findClientOrFail(ctx, telegramId);
  if (!lookup.ok) return;
  const client = lookup.client;

  // быстрый путь — только если постоянное согласие действует под текущей
  // версией политики; иначе показываем свежий шаг согласия
  if (
    client &&
    client.client_consent_given &&
    client.client_consent_version === PRIVACY_POLICY_VERSION
  ) {
    await submitIndividRequest(ctx, from, client);
    return;
  }
  await sendCoachRequestConsentStep(ctx);
}

// Подтверждение согласия на кнопке: согласие записывается атомарно вместе
// с созданием заявки; повторные тапы идемпотентны (дедуп + 23505).
export async function handleConsentCoachRequest(ctx: MyContext): Promise<void> {
  const from = ctx.from;
  if (!from?.id) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }
  const telegramId = from.id;
  await ctx.answerCallbackQuery().catch(() => {});

  const lookup = await findClientOrFail(ctx, telegramId);
  if (!lookup.ok) return;

  await submitIndividRequest(ctx, from, lookup.client);
}