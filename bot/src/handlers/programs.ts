import type { MyContext } from "../bot.js";
import { t, type Language } from "../i18n/index.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { config } from "../config.js";
import { InlineKeyboard } from "grammy";

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Program {
  id: string;
  title: string;
  type: string | null;
  description: string | null;
  duration_weeks: number | null;
  price: number | null;
}

function formatProgram(index: number, program: Program, lang: Language): string {
  const type = program.type || "—";
  const weeks = program.duration_weeks ?? 12;
  const priceLine = program.price
    ? t("programs.price_line", lang, { price: String(program.price) })
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

    programs.forEach((program, i) => {
      lines.push(formatProgram(i + 1, program, lang));
      lines.push("");
      keyboard.row().text(
        `${t("programs.request_button", lang)} — ${program.title}`,
        `program_request:${program.id}`,
      );
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

    if (coachChatId !== 0n) {
      const { findClientByTelegramId } = await import("../lib/clients.js");
      const client = await findClientByTelegramId(ctx.from.id);
      const clientName = client?.name ?? ctx.from.id;
      const coachMsg = `📩 Клиент ${clientName} запросил программу: ${programTitle}`;
      await bot.api.sendMessage(String(coachChatId), coachMsg);
    }

    await ctx.reply(t("programs.request_sent", lang));
  } catch (err) {
    console.warn(`[PROGRAMS] Failed to send request:`, err);
    await ctx.reply(t("programs.request_error", lang));
  }
}
