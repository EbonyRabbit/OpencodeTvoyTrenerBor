import cron from "node-cron";
import { InlineKeyboard } from "grammy";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { findClientByTelegramId } from "../lib/clients.js";
import { t, type Language } from "../i18n/index.js";
import { getTodayWorkout, getTodayDateStr } from "../lib/workout-utils.js";
import { DEFAULT_TIMEZONE } from "../handlers/evening-poll.js";

const POLL_CRON = "0 * * * *";

function buildEveningKeyboard(lang: Language): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("evening.btn_yes", lang), "evening_yes")
    .text(t("evening.btn_no", lang), "evening_no")
    .text(t("evening.btn_postpone", lang), "evening_postpone");
}

export function startEveningPollCron(bot: { api: { sendMessage: (chatId: number, text: string, options?: Record<string, unknown>) => Promise<unknown> } }): void {
  cron.schedule(POLL_CRON, async () => {
    try {
      const { data: clients, error } = await supabaseAdmin
        .from("clients")
        .select("id, telegram_id, timezone, language, program_id")
        .eq("status", "active")
        .not("telegram_id", "is", null)
        .not("program_id", "is", null);

      if (error || !clients) {
        console.warn("[CRON] Failed to fetch clients:", error);
        return;
      }

      const now = new Date();

      for (const client of clients) {
        if (!client.telegram_id) continue;

        const tz = client.timezone || DEFAULT_TIMEZONE;
        const clientTime = new Date(now.toLocaleString("en-US", { timeZone: tz }));
        const hour = clientTime.getHours();

        if (hour !== 20) continue;

        try {
          const todayStr = getTodayDateStr(tz);
          const dedupKey = `evening_poll:${client.id}:${todayStr}`;

          const { data: existing } = await supabaseAdmin
            .from("bot_dedup")
            .select("id")
            .eq("key", dedupKey)
            .limit(1);

          if (existing && existing.length > 0) continue;

          const fullClient = await findClientByTelegramId(client.telegram_id);
          if (!fullClient) continue;

          const workout = await getTodayWorkout(fullClient);
          if (!workout) continue;

          const lang = (client.language || "ru") as Language;
          const keyboard = buildEveningKeyboard(lang);
          const question = t("evening.poll_question", lang);

          await bot.api.sendMessage(client.telegram_id, question, {
            reply_markup: keyboard,
          });

          await supabaseAdmin
            .from("bot_dedup")
            .insert({ key: dedupKey } as never);

          console.log(`[CRON] Evening poll sent to ${client.telegram_id}`);
        } catch (err) {
          console.warn(`[CRON] Failed to send poll to ${client.telegram_id}:`, err);
        }
      }
    } catch (err) {
      console.error("[CRON] Evening poll cron error:", err);
    }
  });
}
