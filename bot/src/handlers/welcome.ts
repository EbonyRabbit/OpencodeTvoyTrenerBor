import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InlineKeyboard, InputFile } from "grammy";
import type { MyContext } from "../bot.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { t } from "../i18n/index.js";

export const WELCOME_PARAMS = new Set(["channel_grow", "zir_inst"]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cachedPdfPath: string | null | undefined;

function resolvePdfPath(): string | null {
  if (cachedPdfPath !== undefined) return cachedPdfPath;
  const candidates = [
    path.resolve(process.cwd(), "docs/welcome-fribi/checklist-7min.pdf"),
    path.resolve(__dirname, "../../assets/checklist-7min.pdf"),
    path.resolve(__dirname, "../../../docs/welcome-fribi/checklist-7min.pdf"),
    path.resolve(__dirname, "../../docs/welcome-fribi/checklist-7min.pdf"),
  ];
  for (const p of candidates) if (existsSync(p)) return (cachedPdfPath = p);
  cachedPdfPath = null;
  return null;
}

export async function handleWelcome(ctx: MyContext, rawParam: string): Promise<void> {
  const telegramId = ctx.from?.id;
  const param = rawParam.trim().toLowerCase();
  const isZir = param === "zir_inst";

  const text = isZir ? t("welcome.zir_inst", ctx.language) : t("welcome.channel_grow", ctx.language);

  const keyboard = new InlineKeyboard()
    .text(t("welcome.btn_plan", ctx.language), "welcome:plan")
    .text(t("welcome.btn_browse", ctx.language), "welcome:browse");

  const pdfPath = resolvePdfPath();
  if (pdfPath) {
    try {
      await ctx.replyWithDocument(new InputFile(createReadStream(pdfPath), "checklist-7min.pdf"), {
        caption: text,
        reply_markup: keyboard,
      });
    } catch (err) {
      console.warn(`[WELCOME] Failed to send PDF to ${telegramId}:`, err);
      await ctx.reply(text, { reply_markup: keyboard });
    }
  } else {
    console.warn(`[WELCOME] PDF not found, sending text only to ${telegramId}`);
    await ctx.reply(text, { reply_markup: keyboard });
  }

  if (telegramId) {
    try {
      const { error } = await supabaseAdmin.from("bot_logs").insert({
        action: "welcome_sent",
        telegram_id: telegramId,
        details: rawParam.trim().slice(0, 64),
        status: "ok",
      });
      if (error) console.warn(`[WELCOME] bot_logs insert failed for ${telegramId}:`, error);
    } catch (err) {
      console.warn(`[WELCOME] Failed to log welcome_sent for ${telegramId}:`, err);
    }
  }
}

export async function handleWelcomeCallback(ctx: MyContext, data: string): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  if (data === "welcome:plan") {
    await ctx.reply(t("welcome.plan_hint", ctx.language));
  } else if (data === "welcome:browse") {
    await ctx.reply(t("welcome.browse_hint", ctx.language));
  }
}
