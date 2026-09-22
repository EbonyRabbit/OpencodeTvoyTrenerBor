import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InlineKeyboard, InputFile } from "grammy";
import type { MyContext } from "../bot.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { t } from "../i18n/index.js";
import { setState, clearState } from "../state/machine.js";
import { calcCalories, parseWeightKg, type GuideSex, type GuideGoal } from "../lib/calorie-calc.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cachedGuidePdf: string | null | undefined;

function resolveGuidePdf(): string | null {
  if (cachedGuidePdf !== undefined) return cachedGuidePdf;
  const candidates = [
    path.resolve(process.cwd(), "docs/guides/calorie-guide/guide.pdf"),
    path.resolve(__dirname, "../../assets/guide.pdf"),
    path.resolve(__dirname, "../../../docs/guides/calorie-guide/guide.pdf"),
    path.resolve(__dirname, "../../docs/guides/calorie-guide/guide.pdf"),
  ];
  for (const p of candidates) if (existsSync(p)) return (cachedGuidePdf = p);
  cachedGuidePdf = null;
  return null;
}

async function logWelcome(telegramId: number | undefined, details: string): Promise<void> {
  if (!telegramId) return;
  try {
    const { error } = await supabaseAdmin.from("bot_logs").insert({
      action: "welcome_sent",
      telegram_id: telegramId,
      details: details.slice(0, 64),
      status: "ok",
    });
    if (error) console.warn(`[GUIDE] bot_logs insert failed for ${telegramId}:`, error);
  } catch (err) {
    console.warn(`[GUIDE] Failed to log welcome_sent for ${telegramId}:`, err);
  }
}

async function safeReply(ctx: MyContext, text: string, extra?: Parameters<MyContext["reply"]>[1]): Promise<boolean> {
  try {
    await ctx.reply(text, extra as never);
    return true;
  } catch (err) {
    console.warn(`[GUIDE] reply failed:`, err);
    return false;
  }
}

export async function handleGuideStart(ctx: MyContext): Promise<void> {
  const telegramId = ctx.from?.id;
  const keyboard = new InlineKeyboard()
    .text(t("guide.btn_female", ctx.language), "guide:sex:F")
    .text(t("guide.btn_male", ctx.language), "guide:sex:M")
    .row()
    .text(t("guide.btn_cancel", ctx.language), "guide:cancel");
  try {
    await ctx.reply(t("guide.intro", ctx.language), { reply_markup: keyboard });
  } catch (err) {
    console.warn(`[GUIDE] intro send failed:`, err);
    return;
  }
  if (telegramId) {
    try {
      await setState(telegramId, { action: "guide_calories", step: "sex" }, ctx.state ?? null);
    } catch (err) {
      console.warn(`[GUIDE] setState sex failed for ${telegramId}:`, err);
    }
    await logWelcome(telegramId, "guide_calories");
  }
}

export async function handleGuideCallback(ctx: MyContext, data: string): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  if (data === "guide:start") {
    await handleGuideStart(ctx);
    return;
  }

  if (data === "guide:cancel") {
    try {
      await clearState(telegramId);
    } catch {}
    await safeReply(ctx, t("guide.cancelled", ctx.language));
    return;
  }

  if (data.startsWith("guide:sex:")) {
    const sex = data.slice("guide:sex:".length) as GuideSex;
    if (sex !== "F" && sex !== "M") return;
    try {
      await setState(telegramId, { action: "guide_calories", step: "weight", data: { sex } }, ctx.state ?? null);
    } catch (err) {
      console.warn(`[GUIDE] setState weight failed:`, err);
    }
    await safeReply(ctx, t("guide.ask_weight", ctx.language));
    return;
  }

  if (data.startsWith("guide:goal:")) {
    const goal = data.slice("guide:goal:".length) as GuideGoal;
    if (goal !== "cut" && goal !== "bulk" && goal !== "maintain") return;
    const sex = ctx.state?.data?.sex as GuideSex | undefined;
    const weight = Number(ctx.state?.data?.weight);
    if ((sex !== "F" && sex !== "M") || !Number.isFinite(weight) || weight < 35 || weight > 250) {
      try {
        await setState(telegramId, { action: "guide_calories", step: "sex" }, ctx.state ?? null);
      } catch {}
      await safeReply(ctx, t("guide.ask_sex", ctx.language));
      return;
    }
    await sendResult(ctx, sex, weight, goal);
    return;
  }

  if (data === "guide:pdf") {
    await sendPdf(ctx);
    return;
  }

  if (data === "guide:plate") {
    await safeReply(ctx, t("guide.plate_hint", ctx.language));
    return;
  }

  if (data === "guide:restart") {
    try {
      await setState(telegramId, { action: "guide_calories", step: "sex" }, ctx.state ?? null);
    } catch {}
    const keyboard = new InlineKeyboard()
      .text(t("guide.btn_female", ctx.language), "guide:sex:F")
      .text(t("guide.btn_male", ctx.language), "guide:sex:M")
      .row()
      .text(t("guide.btn_cancel", ctx.language), "guide:cancel");
    await safeReply(ctx, t("guide.ask_sex", ctx.language), { reply_markup: keyboard });
    return;
  }
}

export async function handleGuideInput(ctx: MyContext): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return false;
  if (ctx.state?.action !== "guide_calories") return false;

  const step = ctx.state?.step;
  const text = (ctx.message?.text ?? "").trim();
  if (!text) return true;
  if (text.startsWith("/")) return false;
  if (/^(отмена|cancel|стоп|назад)$/i.test(text)) {
    try {
      await clearState(telegramId);
    } catch {}
    await safeReply(ctx, t("guide.cancelled", ctx.language));
    return true;
  }

  if (step === "sex") {
    const low = text.toLowerCase();
    let sex: GuideSex | null = null;
    if (/девушк|девочк|женщин|female/.test(low)) sex = "F";
    else if (/(^|[\s,.;!?:])(?<!за)мужчина($|[\s,.;!?:])|(^|[\s,.;!?:])(?<!за)муж($|[\s,.;!?:])|парень|male/.test(low)) sex = "M";
    else if (low === "ж" || low === "f") sex = "F";
    else if (low === "м" || low === "m") sex = "M";
    if (!sex) {
      const keyboard = new InlineKeyboard()
        .text(t("guide.btn_female", ctx.language), "guide:sex:F")
        .text(t("guide.btn_male", ctx.language), "guide:sex:M")
        .row()
        .text(t("guide.btn_cancel", ctx.language), "guide:cancel");
      await safeReply(ctx, t("guide.ask_sex", ctx.language), { reply_markup: keyboard });
      return true;
    }
    try {
      await setState(telegramId, { action: "guide_calories", step: "weight", data: { ...(ctx.state?.data ?? {}), sex } }, ctx.state ?? null);
    } catch {}
    await safeReply(ctx, t("guide.ask_weight", ctx.language));
    return true;
  }

  if (step === "weight") {
    const w = parseWeightKg(text);
    if (w == null) {
      await safeReply(ctx, t("guide.bad_weight", ctx.language));
      return true;
    }
    const keyboard = new InlineKeyboard()
      .text(t("guide.btn_cut", ctx.language), "guide:goal:cut")
      .text(t("guide.btn_maintain", ctx.language), "guide:goal:maintain")
      .row()
      .text(t("guide.btn_bulk", ctx.language), "guide:goal:bulk")
      .row()
      .text(t("guide.btn_cancel", ctx.language), "guide:cancel");
    try {
      await setState(
        telegramId,
        { action: "guide_calories", step: "goal", data: { ...(ctx.state?.data ?? {}), weight: w } },
        ctx.state ?? null,
      );
    } catch {}
    await safeReply(ctx, t("guide.ask_goal", ctx.language), { reply_markup: keyboard });
    return true;
  }

  if (step === "goal") {
    const low = text.toLowerCase();
    let goal: GuideGoal | null = null;
    if (/похуд|худе|сброс|дефицит|стройн|похудеть|(?<![a-zа-яё])cut(?![a-zа-яё])/.test(low)) goal = "cut";
    else if (/набрать|набор|профицит|масс(?!аж)|(?<![a-zа-яё])bulk(?![a-zа-яё])/.test(low)) goal = "bulk";
    else if (/удерж|поддерж|держ.*форм|maintain|норма|(?<![a-zа-яё])форм[а-яё]+(?![a-zа-яё])/.test(low)) goal = "maintain";
    if (!goal) {
      const keyboard = new InlineKeyboard()
        .text(t("guide.btn_cut", ctx.language), "guide:goal:cut")
        .text(t("guide.btn_maintain", ctx.language), "guide:goal:maintain")
        .row()
        .text(t("guide.btn_bulk", ctx.language), "guide:goal:bulk")
        .row()
        .text(t("guide.btn_cancel", ctx.language), "guide:cancel");
      await safeReply(ctx, t("guide.ask_goal", ctx.language), { reply_markup: keyboard });
      return true;
    }
    const sex = ctx.state?.data?.sex as GuideSex | undefined;
    const weight = Number(ctx.state?.data?.weight);
    if ((sex !== "F" && sex !== "M") || !Number.isFinite(weight) || weight < 35 || weight > 250) {
      try {
        await setState(telegramId, { action: "guide_calories", step: "sex" }, ctx.state ?? null);
      } catch {}
      await safeReply(ctx, t("guide.ask_sex", ctx.language));
      return true;
    }
    await sendResult(ctx, sex, weight, goal);
    return true;
  }

  if (step === "done") return false;

  return false;
}

async function sendResult(ctx: MyContext, sex: GuideSex, weight: number, goal: GuideGoal): Promise<void> {
  const telegramId = ctx.from?.id;
  const r = calcCalories(sex, weight, goal);
  const goalLabel =
    goal === "cut" ? t("guide.goal_cut", ctx.language) : goal === "bulk" ? t("guide.goal_bulk", ctx.language) : t("guide.goal_maintain", ctx.language);

  try {
    await ctx.reply(
      t("guide.result", ctx.language, {
        weight,
        goal: goalLabel,
        maintenance: r.maintenance,
        protein: r.targetProteinG,
        fat: r.targetFatG,
        carbs: r.targetCarbsG,
        target: r.targetCalories,
      } as Record<string, string | number>),
    );
  } catch (err) {
    console.warn(`[GUIDE] result send failed:`, err);
    return;
  }

  const keyboard = new InlineKeyboard()
    .text(t("guide.btn_pdf", ctx.language), "guide:pdf")
    .text(t("guide.btn_plate", ctx.language), "guide:plate")
    .row()
    .text(t("guide.btn_restart", ctx.language), "guide:restart");
  try {
    await ctx.reply(t("guide.after_result", ctx.language), { reply_markup: keyboard });
  } catch (err) {
    console.warn(`[GUIDE] after_result send failed:`, err);
    return;
  }

  if (telegramId) {
    try {
      await setState(telegramId, { action: "guide_calories", step: "done", data: { sex, weight, goal } }, ctx.state ?? null);
    } catch (err) {
      console.warn(`[GUIDE] setState done failed:`, err);
    }
  }
}

async function sendPdf(ctx: MyContext): Promise<void> {
  const pdfPath = resolveGuidePdf();
  const caption = t("guide.pdf_caption", ctx.language);
  if (pdfPath) {
    try {
      await ctx.replyWithDocument(new InputFile(createReadStream(pdfPath), "calorie-guide.pdf"), { caption });
      return;
    } catch (err) {
      console.warn(`[GUIDE] Failed to send PDF:`, err);
    }
  } else {
    console.warn(`[GUIDE] PDF not found, sending text only`);
  }
  await safeReply(ctx, caption);
}
