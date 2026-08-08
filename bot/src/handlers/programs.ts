import type { MyContext } from "../bot.js";
import { t, type Language } from "../i18n/index.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { config } from "../config.js";
import { buildBuyUrl, buildProgramRequestCoachMessage } from "../lib/program-links.js";
import { InlineKeyboard } from "grammy";

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const TELEGRAM_BUTTON_MAX_BYTES = 64;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Program {
  id: string;
  title: string;
  type: string | null;
  description: string | null;
  duration_weeks: number | null;
  price: number | null;
}

function truncateButtonLabel(label: string, maxBytes = TELEGRAM_BUTTON_MAX_BYTES): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(label);
  if (bytes.length <= maxBytes) return label;

  const ELLIPSIS = "…";
  const ELLIPSIS_BYTES = 3;

  for (let i = label.length - 1; i >= 0; i--) {
    const candidate = label.slice(0, i);
    if (encoder.encode(candidate).length + ELLIPSIS_BYTES <= maxBytes) {
      return candidate + ELLIPSIS;
    }
  }
  return ELLIPSIS;
}

function formatPrice(price: number | null): string {
  if (price === null || !Number.isFinite(price)) return "";
  return `${price.toLocaleString("ru-RU")} ₽`;
}

function formatProgram(index: number, program: Program, lang: Language): string {
  const type = program.type || "—";
  const weeks = program.duration_weeks ?? 12;
  const priceLine = program.price != null
    ? t("programs.price_line", lang, { price: formatPrice(program.price) })
    : "";
  const descriptionLine = program.description
    ? t("programs.description_line", lang, { description: program.description.slice(0, 100) })
    : "";

  return t("programs.item", lang, {
    index,
    title: program.title,
    type,
    weeks,
    price_line: priceLine,
    description_line: descriptionLine,
  });
}

export async function programsHandler(ctx: MyContext): Promise<void> {
  if (!ctx.from?.id) {
    await ctx.reply(t("error.user_not_identified", ctx.language));
    return;
  }

  const lang = ctx.language;

  try {
    const { data: programs, error } = await supabaseAdmin
      .from("programs")
      .select("id, title, type, description, duration_weeks, price")
      .eq("active", true)
      .is("client_id", null)
      .order("title");

    if (error) {
      console.error(`[PROGRAMS] Query error:`, error.message);
      await ctx.reply(t("error.service_unavailable", lang));
      return;
    }

    if (!programs || programs.length === 0) {
      await ctx.reply(t("programs.empty", lang));
      return;
    }

    const lines: string[] = [t("programs.title", lang), ""];
    const keyboard = new InlineKeyboard();
    const buyerTelegramId = ctx.from.id;
    const buyerUsername = ctx.from.username ?? null;

    programs.forEach((program, i) => {
      lines.push(formatProgram(i + 1, program, lang));
      lines.push("");
      const requestLabel = truncateButtonLabel(
        `${t("programs.request_button", lang)} — ${program.title}`,
      );
      if (config.paymentBaseUrl) {
        const buyLabel = truncateButtonLabel(
          `${t("programs.buy_button", lang)} — ${program.title}`,
        );
        const buyUrl = buildBuyUrl(
          config.paymentBaseUrl,
          program.id,
          buyerTelegramId,
          buyerUsername,
        );
        keyboard.row()
          .url(buyLabel, buyUrl)
          .text(requestLabel, `program_request:${program.id}`);
      } else {
        keyboard.row().text(requestLabel, `program_request:${program.id}`);
      }
    });

    const message = lines.join("\n");
    const truncated = message.length > TELEGRAM_MAX_MESSAGE_LENGTH
      ? message.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH - 50) + "\n\n⚠️ …"
      : message;

    await ctx.reply(truncated, { reply_markup: keyboard });
  } catch (err) {
    console.error(`[PROGRAMS] Error:`, err);
    await ctx.reply(t("error.service_unavailable", lang));
  }
}

export async function handleProgramRequestCallback(ctx: MyContext, programId: string): Promise<void> {
  if (!ctx.from?.id) {
    await ctx.answerCallbackQuery();
    return;
  }

  const lang = ctx.language;

  if (!UUID_REGEX.test(programId)) {
    await ctx.answerCallbackQuery({ text: t("error.unknown_callback", lang), show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery();

  try {
    const { data: program } = await supabaseAdmin
      .from("programs")
      .select("title")
      .eq("id", programId)
      .maybeSingle();

    const programTitle = program?.title ?? programId;

    const bot = (await import("../bot.js")).bot;
    const coachChatId = config.coachChatId;
    let notificationFailed = false;

    if (coachChatId !== 0n) {
      const { findClientByTelegramId } = await import("../lib/clients.js");
      const client = await findClientByTelegramId(ctx.from.id);
      const clientName = client?.name ?? "Неизвестный клиент";
      const coachMsg = buildProgramRequestCoachMessage({
        clientName,
        telegramId: ctx.from.id,
        username: ctx.from.username ?? null,
        programTitle,
      });
      try {
        await bot.api.sendMessage(String(coachChatId), coachMsg);
      } catch (sendErr) {
        console.warn(`[PROGRAMS] Coach notification failed for ${ctx.from.id}:`, sendErr);
        notificationFailed = true;
      }
    } else {
      notificationFailed = true;
    }

    const { error: logError } = await supabaseAdmin.from("bot_logs").insert({
      action: notificationFailed ? "program_request:coach_notification_failed" : "program_request",
      status: notificationFailed ? "error" : "info",
      telegram_id: ctx.from.id,
      details: JSON.stringify({ program_id: programId, program_title: programTitle }),
    });
    if (logError) {
      console.warn("[PROGRAMS] Failed to log request:", logError.message);
    }

    if (notificationFailed) {
      await ctx.reply(t("programs.request_error", lang));
      return;
    }

    await ctx.reply(t("programs.request_sent", lang));
  } catch (err) {
    console.warn(`[PROGRAMS] Failed to send request:`, err);
    await ctx.reply(t("programs.request_error", lang));
  }
}
