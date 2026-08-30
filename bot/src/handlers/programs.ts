import type { MyContext } from "../bot.js";
import { t, type Language } from "../i18n/index.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { config } from "../config.js";
import { InlineKeyboard } from "grammy";
import { truncateMessage } from "../lib/workout-utils.js";

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const TELEGRAM_BUTTON_MAX_BYTES = 64;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Program {
  id: string;
  title: string;
  type: string | null;
  sport: string | null;
  description: string | null;
  duration_weeks: number | null;
  price: number | null;
}

const BOT_SPORT_FILTERS: { label: string; value: string | null }[] = [
  { label: "Все", value: null },
  { label: "🎾 Теннис", value: "tennis" },
  { label: "🏃 Бег", value: "running" },
  { label: "🚴 Триатлон", value: "triathlon" },
  { label: "🏊 Плавание", value: "swimming" },
];

const BOT_SPORT_LABELS: Record<string, string> = {
  tennis: "🎾 Теннис",
  running: "🏃 Бег",
  triathlon: "🚴 Триатлон",
  swimming: "🏊 Плавание",
  hyrox: "🏋️ HYROX",
  general: "Общее",
};

export function truncateButtonLabel(label: string, maxBytes = TELEGRAM_BUTTON_MAX_BYTES): string {
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
  const type = program.type || "-";
  const sport = program.sport ? (BOT_SPORT_LABELS[program.sport] ?? program.sport) : "";
  const weeks = program.duration_weeks ?? 12;
  const priceLine = program.price != null
    ? t("programs.price_line", lang, { price: formatPrice(program.price) })
    : "";
  const descriptionLine = program.description
    ? t("programs.description_line", lang, { description: program.description.slice(0, 100) })
    : "";

  const sportLine = sport ? `🏆 ${sport}\n` : "";
  return (
    sportLine +
    t("programs.item", lang, {
      index,
      title: program.title,
      type,
      weeks,
      price_line: priceLine,
      description_line: descriptionLine,
    })
  );
}

export async function programsHandler(
  ctx: MyContext,
  sportFilter: string | null = null,
): Promise<void> {
  if (!ctx.from?.id) {
    await ctx.reply(t("error.user_not_identified", ctx.language));
    return;
  }

  const lang = ctx.language;

  try {
    let query = supabaseAdmin
      .from("programs")
      .select("id, title, type, sport, description, duration_weeks, price")
      .eq("active", true)
      .eq("type", "template")
      .is("client_id", null);

    const VALID_SPORTS = ["tennis", "running", "triathlon", "swimming", "hyrox", "general"];
    if (sportFilter && VALID_SPORTS.includes(sportFilter)) {
      query = query.eq("sport", sportFilter);
    }

    const { data: programs, error } = await query.order("title");

    if (error) {
      console.error(`[PROGRAMS] Query error:`, error.message);
      await ctx.reply(t("error.service_unavailable", lang));
      return;
    }

    if (!programs || programs.length === 0) {
      const emptyKeyboard = new InlineKeyboard().text(
        t("coach_request.button", lang),
        "coach_request",
      );
      await ctx.reply(t("programs.empty", lang), { reply_markup: emptyKeyboard });
      return;
    }

    // программы, которыми пользователь уже владеет, не предлагаем к покупке
    let ownedProgramIds = new Set<string>();
    try {
      const { findClientByTelegramId } = await import("../lib/clients.js");
      const client = await findClientByTelegramId(ctx.from.id);
      if (client?.program_id) ownedProgramIds = new Set([client.program_id]);
    } catch (err) {
      console.warn(`[PROGRAMS] Client lookup failed for ${ctx.from.id}:`, err);
    }

    const lines: string[] = [t("programs.title", lang), ""];
    const keyboard = new InlineKeyboard();

    // Строка фильтра по виду спорта (первой строкой каталога).
    for (const f of BOT_SPORT_FILTERS) {
      const active = (sportFilter ?? null) === f.value;
      keyboard.text(active ? `✓ ${f.label}` : f.label, `programs_sport:${f.value ?? "all"}`);
    }
    keyboard.row();

    // Короткие подписи: полное название программы уже в тексте блока выше,
    // а лимит Telegram - 64 байта на надпись кнопки. При нескольких
    // программах добавляем номер кнопкам - он соответствует нумерации
    // блоков в тексте и однозначно связывает кнопки с программой.
    const numbered = programs.length > 1;
    programs.forEach((program, i) => {
      lines.push(formatProgram(i + 1, program, lang));
      lines.push("");
      // Короткие подписи: полное название программы уже в тексте блока выше,
      // а лимит Telegram - 64 байта на надпись кнопки.
      const num = numbered ? ` ${i + 1}` : "";
      const buyable =
        program.price != null && program.price > 0 && !ownedProgramIds.has(program.id);
      const row = keyboard
        .text(
          t("programs.details_button", lang) + num,
          `program_details:${program.id}`,
        );
      if (buyable) {
        row.text(t("programs.buy_button", lang) + num, `purchase_start:${program.id}`);
      }
      keyboard.row();
    });

    // отдельная строка внизу каталога: заявка на индивидуальное ведение
    keyboard.row().text(t("coach_request.button", lang), "coach_request");

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



// ℹ️ Подробнее: полное описание программы отдельным сообщением.
// Доступно всем (в т.ч. не-клиентам) - покупка начинается отсюда.
export async function handleProgramDetailsCallback(ctx: MyContext, programId: string): Promise<void> {
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
    const { data: program, error } = await supabaseAdmin
      .from("programs")
      .select("id, title, type, description, duration_weeks, price")
      .eq("id", programId)
      .eq("active", true)
      .eq("type", "template")
      .is("client_id", null)
      .maybeSingle();

    if (error) {
      console.error(`[PROGRAMS] Details query error:`, error.message);
      await ctx.reply(t("error.service_unavailable", lang));
      return;
    }
    if (!program) {
      await ctx.reply(t("programs.not_found", lang));
      return;
    }

    // владелец программы не видит кнопку «Купить»
    let owned = false;
    try {
      const { findClientByTelegramId } = await import("../lib/clients.js");
      const client = await findClientByTelegramId(ctx.from.id);
      owned = client?.program_id === program.id;
    } catch (err) {
      console.warn(`[PROGRAMS] Client lookup failed for ${ctx.from.id}:`, err);
    }

    const priceLine = program.price != null
      ? t("programs.price_line", lang, { price: formatPrice(program.price) })
      : "";
    const lines: string[] = [
      program.title,
      `${t("programs.item_type_label", lang)} ${program.type || "-"}`,
      `${t("programs.item_weeks_label", lang)} ${program.duration_weeks ?? 12}`,
      priceLine,
    ].filter((line) => line.trim() !== "");
    if (program.description) {
      lines.push("");
      lines.push(program.description);
    }
    const message = truncateMessage(
      lines.join("\n"),
      t("program.truncation_suffix", lang),
    );

    const keyboard = new InlineKeyboard();
    const buyable =
      program.price != null && program.price > 0 && !owned;
    if (buyable) {
      keyboard.text(t("programs.buy_button", lang), `purchase_start:${program.id}`);
    }

    await ctx.reply(message, { reply_markup: keyboard });
  } catch (err) {
    console.warn(`[PROGRAMS] Details error for ${ctx.from.id}:`, err);
    await ctx.reply(t("error.service_unavailable", lang));
  }
}
