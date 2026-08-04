import type { MyContext } from "../bot.js";
import { findClientByTelegramId } from "../lib/clients.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { t } from "../i18n/index.js";
import { guardActiveClient } from "./guards.js";

export async function menuHandler(ctx: MyContext): Promise<void> {
  const telegramId = ctx.from?.id;

  if (!telegramId) {
    await ctx.reply(t("error.user_not_identified", ctx.language));
    return;
  }

  try {
    const guard = await guardActiveClient(ctx);
    if (typeof guard === "string") {
      await ctx.reply(guard);
      return;
    }

    const { client } = guard;

    const lines = [
      t("greeting.hello", ctx.language, { name: client.name ?? t("greeting.default_name", ctx.language) }),
      "",
      t("menu.title", ctx.language),
      t("menu.today", ctx.language),
      t("menu.progress", ctx.language),
      t("menu.checkin", ctx.language),
      t("menu.myprogram", ctx.language),
      t("menu.programs", ctx.language),
      t("menu.pause", ctx.language),
      t("menu.resume", ctx.language),
      t("menu.myweb", ctx.language),
      t("menu.schedule", ctx.language),
      t("menu.settings", ctx.language),
    ];

    if (client.purchased_program_id) {
      try {
        const { data: program } = await supabaseAdmin
          .from("programs")
          .select("title")
          .eq("id", client.purchased_program_id)
          .maybeSingle<{ title: string }>();
        if (program?.title) {
          lines.splice(1, 0, t("client.purchased", ctx.language, { title: program.title }));
        }
      } catch (err) {
        console.error(`[MENU] Failed to fetch purchased program for ${ctx.from?.id}:`, err);
      }
    }

    await ctx.reply(lines.join("\n"));
  } catch (err) {
    console.error(`[MENU] Error for ${ctx.from?.id}:`, err);
    try {
      await ctx.reply(t("error.service_unavailable", ctx.language));
    } catch {
      // fallback reply failed
    }
  }
}
