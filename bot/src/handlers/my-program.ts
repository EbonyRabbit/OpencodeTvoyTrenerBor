import type { MyContext } from "../bot.js";
import { findClientByTelegramId } from "../lib/clients.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import {
  getParsedContent,
  buildSpreadsheetUrl,
  getTotalWeeks,
  getCurrentWeek,
  getWorkoutDaysCount,
} from "../lib/program-utils.js";

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const TRUNCATION_SUFFIX = "\n\n⚠️ Сообщение обрезано. Полная версия в таблице.";

export async function myProgramHandler(ctx: MyContext): Promise<void> {
  const telegramId = ctx.from?.id;

  if (!telegramId) {
    await ctx.reply("Ошибка: не удалось определить вашего пользователя.");
    return;
  }

  try {
    const client = await findClientByTelegramId(telegramId);

    if (!client) {
      await ctx.reply("Добро пожаловать! Приобретите программу у тренера для начала тренировок.");
      return;
    }

    const safeName = client.name ?? "клиент";

    if (client.status === "access_expired") {
      await ctx.reply("Ваш доступ истёк. Продлите программу у тренера.");
      return;
    }

    if (client.status === "inactive") {
      await ctx.reply("Аккаунт неактивен. Свяжитесь с тренером.");
      return;
    }

    if (client.payment_status === "pending") {
      await ctx.reply("Ожидается подтверждение оплаты.");
      return;
    }

    if (!client.program_id) {
      await ctx.reply(
        [
          `Привет, ${safeName}!`,
          "",
          "Программа ещё не назначена.",
          "Ожидайте — тренер скоро свяжется с вами.",
        ].join("\n"),
      );
      return;
    }

    const { data: program, error: programError } = await supabaseAdmin
      .from("programs")
      .select("id, title, type, duration_weeks, parsed_content, description")
      .eq("id", client.program_id)
      .maybeSingle();

    if (programError) {
      console.error(`[MYPROGRAM] Program query error for ${telegramId}:`, programError.message);
      await ctx.reply("Сервис временно недоступен. Попробуйте позже.");
      return;
    }

    if (!program) {
      await ctx.reply(
        [
          `Привет, ${safeName}!`,
          "",
          "Программа не найдена в системе.",
          "Свяжитесь с тренером для уточнения.",
        ].join("\n"),
      );
      return;
    }

    const { data: schedule, error: scheduleError } = await supabaseAdmin
      .from("program_schedule")
      .select("week_number, start_date, end_date, is_deload, focus")
      .eq("client_id", client.id)
      .order("week_number");

    if (scheduleError) {
      console.error(`[MYPROGRAM] Schedule query error for ${telegramId}:`, scheduleError.message);
    }

    const parsed = getParsedContent(program.parsed_content);
    const totalWeeks = getTotalWeeks(parsed);
    const currentWeek = getCurrentWeek(schedule ?? []);

    const lines: string[] = [
      `Привет, ${safeName}!`,
      "",
      `📋 Программа: ${program.title}`,
    ];

    if (program.type) {
      lines.push(`🏷 Тип: ${program.type}`);
    }

    if (program.duration_weeks) {
      lines.push(`⏱ Длительность: ${program.duration_weeks} нед.`);
    }

    if (totalWeeks > 0 && currentWeek !== null) {
      const currentWeekData = parsed?.weeks?.find((w) => w.week_number === currentWeek);
      const label = currentWeekData?.week_label || `Неделя ${currentWeek}`;
      const deload = currentWeekData?.is_deload ? " (дельоад)" : "";
      lines.push(`📅 Текущая: ${label}${deload} (${currentWeek} из ${totalWeeks})`);

      const workoutDays = getWorkoutDaysCount(parsed, currentWeek);
      if (workoutDays > 0) {
        lines.push(`💪 Тренировочных дней: ${workoutDays}`);
      }

      if (currentWeekData?.days && currentWeekData.days.length > 0) {
        lines.push("");
        lines.push("Дни недели:");
        for (const day of currentWeekData.days) {
          const exCount = day.exercises?.length ?? 0;
          const icon = exCount > 0 ? "✅" : "⬜";
          lines.push(`  ${icon} ${day.day_name}`);
        }
      }
    } else if (totalWeeks > 0) {
      lines.push(`📅 Всего недель: ${totalWeeks}`);
    }

    const spreadsheetUrl = buildSpreadsheetUrl(client.spreadsheet_id);
    if (spreadsheetUrl) {
      lines.push("");
      lines.push(`📊 Таблица: ${spreadsheetUrl}`);
    }

    if (program.description) {
      lines.push("");
      lines.push(`📝 ${program.description}`);
    }

    const message = lines.join("\n");
    if (message.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
      const limit = TELEGRAM_MAX_MESSAGE_LENGTH - TRUNCATION_SUFFIX.length - 1;
      const truncated = message.slice(0, limit);
      const lastNewline = truncated.lastIndexOf("\n");
      const safeTruncated = lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated;
      await ctx.reply(safeTruncated + TRUNCATION_SUFFIX);
    } else {
      await ctx.reply(message);
    }
  } catch (err) {
    console.error(`[MYPROGRAM] Error for ${telegramId}:`, err);
    try {
      await ctx.reply("Сервис временно недоступен. Попробуйте позже.");
    } catch {
      // fallback reply failed
    }
  }
}
