import { randomUUID } from "node:crypto";
import type { MyContext } from "../bot.js";
import { t, applyClientLanguage } from "../i18n/index.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { config } from "../config.js";
import { buildPrivacyUrl, PRIVACY_POLICY_VERSION } from "./consent.js";
import { findClientByTelegramId, type Client } from "../lib/clients.js";
import { getParsedContent } from "../lib/program-utils.js";
import { switchProgramPeriod } from "../lib/program-periods.js";
import { InlineKeyboard } from "grammy";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Блокировка на время переключения: двойной тап по той же кнопке confirm
// не должен создавать два периода. Бот однопроцессный, окно 10 секунд;
// ключ - клиент+программа: осознанный выбор другой программы не блокируем.
const CONFIRM_LOCK_WINDOW_MS = 10_000;
const confirmLocks = new Map<string, number>();

function acquireConfirmLock(clientId: string, programId: string): boolean {
  const now = Date.now();
  for (const [key, ts] of confirmLocks) {
    if (now - ts > CONFIRM_LOCK_WINDOW_MS) confirmLocks.delete(key);
  }
  const key = `${clientId}:${programId}`;
  const existing = confirmLocks.get(key);
  if (existing !== undefined && now - existing < CONFIRM_LOCK_WINDOW_MS) {
    return false;
  }
  confirmLocks.set(key, now);
  return true;
}

function releaseConfirmLock(clientId: string, programId: string): void {
  confirmLocks.delete(`${clientId}:${programId}`);
}

interface CatalogProgram {
  id: string;
  title: string;
  parsed_content: unknown;
}

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

// Живая подписка (active/past_due) открывает выбор любой программы.
async function findLiveSubscription(clientId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select("id")
    .eq("client_id", clientId)
    .in("status", ["active", "past_due"])
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (error) {
    // fail-closed: нельзя проверить подписку - выбор не открываем
    throw new Error(`Subscription check failed for ${clientId}: ${error.message}`);
  }
  return data !== null;
}

async function fetchCatalogProgram(
  programId: string,
  withParsed: boolean,
): Promise<CatalogProgram | null> {
  const { data } = await supabaseAdmin
    .from("programs")
    .select(withParsed ? "id, title, parsed_content" : "id, title")
    .eq("id", programId)
    .eq("active", true)
    .eq("type", "template")
    .is("client_id", null)
    .maybeSingle<CatalogProgram>();
  return data ?? null;
}

// Кнопка «Выбрать» в каталоге. Работает и для не-клиентов: без подписки
// показываем заглушку, с подпиской - подтверждение и переключение программы.
export async function startProgramChoice(ctx: MyContext, programId: string): Promise<void> {
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

  let program: CatalogProgram;
  try {
    const fetched = await fetchCatalogProgram(programId, false);
    if (!fetched) {
      await ctx.reply(t("subscribe.not_found", ctx.language));
      return;
    }
    program = fetched;
  } catch (err) {
    console.error(`[SUBSCRIBE] Program fetch failed for ${telegramId}:`, err);
    await ctx.reply(t("subscribe.error", ctx.language));
    return;
  }

  let client: Client | null = null;
  try {
    client = await findClientByTelegramId(telegramId);
  } catch (err) {
    // fail-closed: без проверки нельзя решить, есть ли подписка
    console.error(`[SUBSCRIBE] Client lookup failed for ${telegramId}:`, err);
    await ctx.reply(t("subscribe.error", ctx.language));
    return;
  }
  if (client) applyClientLanguage(ctx, client.language);
  const lang = ctx.language;

  if (!client) {
    await ctx.reply(t("subscribe.required", lang));
    return;
  }

  try {
    if (!(await findLiveSubscription(client.id))) {
      await ctx.reply(t("subscribe.required", lang));
      return;
    }
  } catch (err) {
    console.error(`[SUBSCRIBE] Subscription check failed for ${telegramId}:`, err);
    await ctx.reply(t("subscribe.error", lang));
    return;
  }

  const keyboard = new InlineKeyboard()
    .text(t("subscribe.confirm_button", lang), `subscribe_confirm:${program.id}`)
    .row()
    .text(t("subscribe.cancel_button", lang), "subscribe_cancel");
  await ctx.reply(
    t("subscribe.confirm_title", lang, { title: program.title }) +
      "\n\n" +
      t("subscribe.confirm_warning", lang),
    { reply_markup: keyboard },
  );
}

export async function handleSubscribeCancel(ctx: MyContext): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  const telegramId = ctx.from?.id;
  if (telegramId) {
    try {
      const client = await findClientByTelegramId(telegramId);
      if (client) applyClientLanguage(ctx, client.language);
    } catch {
      // отмена не блокируется ошибкой поиска клиента: отвечаем как есть
    }
  }
  await ctx.reply(t("subscribe.cancelled", ctx.language));
}

// Подтверждение выбора: переключение периода атомарно в SQL RPC. Повторный
// выбор той же программы тоже создаёт новый период - веса начинаются заново.
export async function handleSubscribeConfirm(ctx: MyContext, programId: string): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  if (!UUID_REGEX.test(programId)) {
    await ctx.answerCallbackQuery({
      text: t("error.unknown_callback", ctx.language),
      show_alert: true,
    }).catch(() => {});
    return;
  }

  await ctx.answerCallbackQuery().catch(() => {});

  let lang = ctx.language;
  let lockedKey: string | null = null;

  try {
    const program = await fetchCatalogProgram(programId, true);
    if (!program) {
      await ctx.reply(t("subscribe.not_found", lang));
      return;
    }

    const client = await findClientByTelegramId(telegramId);
    if (!client) {
      await ctx.reply(t("subscribe.required", lang));
      return;
    }
    applyClientLanguage(ctx, client.language);
    lang = ctx.language;
    if (!(await findLiveSubscription(client.id))) {
      await ctx.reply(t("subscribe.required", lang));
      return;
    }

    if (!acquireConfirmLock(client.id, program.id)) {
      // повторный тап той же кнопки пока первый в работе: второй период не создаём
      return;
    }
    lockedKey = `${client.id}:${program.id}`;

    const parsed = getParsedContent(
      program.parsed_content as Parameters<typeof getParsedContent>[0],
    );
    const result = await switchProgramPeriod(client.id, program.id, parsed);
    if (result.error) {
      releaseConfirmLock(client.id, program.id);
      console.error(`[SUBSCRIBE] Switch failed for ${telegramId}:`, result.error);
      await ctx.reply(t("subscribe.switch_failed", lang));
      return;
    }

    // блокировка остаётся: повторный тап той же кнопки не создаёт период
    lockedKey = null;
    await ctx.reply(t("subscribe.assigned", lang, { title: program.title }));
  } catch (err) {
    if (lockedKey) confirmLocks.delete(lockedKey);
    console.error(`[SUBSCRIBE] handleSubscribeConfirm failed for ${telegramId}:`, err);
    await ctx.reply(t("subscribe.error", lang));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Заявка «Связаться с тренером» (sub_type='individ'): согласие получаем ДО
// вставки (для не-клиентов единственное хранилище согласия - строка заявки),
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
  const name = [firstName, lastName].filter(Boolean).join(" ").trim() || "-";
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
    // fail-closed: если нельзя проверить отсутствие заявки - заявку не создаём
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
      // winner пропал (гонка отмен тренером) - повторяем вставку один раз
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

// Уведомление тренеру: не блокирует клиента при сбое - заявка уже в БД и
// видна в панели (фиксируем в bot_logs).
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

  // быстрый путь - только если постоянное согласие действует под текущей
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
