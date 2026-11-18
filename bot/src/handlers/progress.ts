import type { MyContext } from "../bot.js";
import { guardActiveClient } from "./guards.js";
import { t } from "../i18n/index.js";

export async function progressHandler(ctx: MyContext): Promise<void> {
  try {
    const guard = await guardActiveClient(ctx);
    if (typeof guard === "string") {
      await ctx.reply(guard);
      return;
    }

    ctx.client = guard.client;
    await ctx.reply(t("progress.title", ctx.language));
  } catch (err) {
    console.error(`[PROGRESS] Error for ${ctx.from?.id}:`, err);
    await ctx.reply(t("error.service_unavailable", ctx.language)).catch(() => {});
  }
}
