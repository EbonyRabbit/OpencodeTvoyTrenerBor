import type { MyContext } from "../bot.js";
import { t, type Language } from "../i18n/index.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { config } from "../config.js";
import { getTodayDateStr, truncateMessage, escapeHtml } from "../lib/workout-utils.js";
import { DEFAULT_TIMEZONE } from "../lib/constants.js";
import { getActivePause } from "../lib/plan-adjustment.js";
import { daysBetween } from "../lib/date-utils.js";
import crypto from "crypto";

const COACH_CHAT_ID = config.coachChatId;
const CODE_LENGTH = 8;
const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_REGEX = /^[a-zA-Zа-яА-ЯёЁ0-9\s\-_.]+$/;

function isCoach(ctx: MyContext): boolean {
  return ctx.from?.id === Number(COACH_CHAT_ID);
}

function generateCode(): string {
  let code = "";
  const bytes = crypto.randomBytes(CODE_LENGTH * 2);
  let i = 0;
  while (code.length < CODE_LENGTH) {
    const val = bytes[i] % 36;
    if (val < 36) {
      code += CODE_CHARS[val];
    }
    i++;
  }
  return code;
}

export async function adminDebugToday(ctx: MyContext): Promise<void> {
  if (!isCoach(ctx)) {
    await ctx.reply(t("chat.coach_only", ctx.language));
    return;
  }

  try {
    const { data: clients, error } = await supabaseAdmin
      .from("clients")
      .select("id, name, telegram_id, timezone, program_id")
      .eq("status", "active")
      .order("name");

    if (error || !clients || clients.length === 0) {
      await ctx.reply("Нет активных клиентов.");
      return;
    }

    const clientIds = clients.map(c => c.id);

    const { data: pauses } = await supabaseAdmin
      .from("plan_pauses")
      .select("client_id, pause_start, status")
      .eq("status", "active")
      .in("client_id", clientIds);

    const pauseMap = new Map<string, string>();
    if (pauses) {
      for (const p of pauses) {
        pauseMap.set(p.client_id, p.pause_start);
      }
    }

    const todayStr = getTodayDateStr(DEFAULT_TIMEZONE);
    const { data: schedules } = await supabaseAdmin
      .from("program_schedule")
      .select("client_id, week_number, is_deload, focus, start_date, end_date")
      .in("client_id", clientIds)
      .lte("start_date", todayStr)
      .gte("end_date", todayStr);

    const scheduleMap = new Map<string, { week_number: number; is_deload: boolean; focus: string | null }>();
    if (schedules) {
      for (const s of schedules) {
        scheduleMap.set(s.client_id, s);
      }
    }

    const lines: string[] = ["📊 Отладка на сегодня:", ""];

    for (const client of clients) {
      const tz = client.timezone || DEFAULT_TIMEZONE;
      const clientToday = getTodayDateStr(tz);

      const pauseStart = pauseMap.get(client.id);
      const pauseInfo = pauseStart
        ? `⏸ Пауза ${daysBetween(pauseStart, clientToday)} дн.`
        : "";

      const schedule = scheduleMap.get(client.id);
      let weekInfo = "";
      if (schedule) {
        weekInfo = `📅 Неделя ${schedule.week_number}${schedule.is_deload ? " (дельоад)" : ""}`;
        if (schedule.focus) weekInfo += ` — ${schedule.focus}`;
      } else if (client.program_id) {
        weekInfo = "📅 Нет активной недели";
      } else {
        weekInfo = "🚫 Без программы";
      }

      const telegramStatus = client.telegram_id ? "✅ TG" : "❌ TG";

      lines.push(`• ${client.name ?? "Без имени"}`);
      lines.push(`  ${weekInfo}`);
      lines.push(`  ${pauseInfo || "Активен"}`);
      lines.push(`  ${telegramStatus} | ${clientToday}`);
      lines.push("");
    }

    const message = lines.join("\n");
    const suffix = "\n\n⚠️ Обрезано";
    const truncated = message.length > 4096
      ? truncateMessage(message, suffix)
      : message;

    await ctx.reply(truncated);
  } catch (err) {
    console.error(`[ADMIN] debug_today error:`, err);
    await ctx.reply("Ошибка при получении данных.");
  }
}

export async function adminRecalcSchedule(ctx: MyContext): Promise<void> {
  if (!isCoach(ctx)) {
    await ctx.reply(t("chat.coach_only", ctx.language));
    return;
  }

  const text = ctx.message?.text ?? "";
  const args = text.split(/\s+/).slice(1);
  const clientArg = args[0];

  try {
    let query = supabaseAdmin
      .from("clients")
      .select("id, name, program_id")
      .eq("status", "active")
      .not("program_id", "is", null);

    if (clientArg) {
      if (UUID_REGEX.test(clientArg)) {
        query = query.eq("id", clientArg);
      } else if (NAME_REGEX.test(clientArg)) {
        const escaped = clientArg.replace(/[%_]/g, "\\$&");
        query = query.ilike("name", `%${escaped}%`);
      } else {
        await ctx.reply("Некорректный формат аргумента. Используйте UUID или имя клиента.");
        return;
      }
    }

    const { data: clients, error } = await query;

    if (error || !clients || clients.length === 0) {
      await ctx.reply("Нет клиентов для пересчёта расписания.");
      return;
    }

    let updated = 0;

    for (const client of clients) {
      if (!client.program_id) continue;

      const { data: program } = await supabaseAdmin
        .from("programs")
        .select("duration_weeks")
        .eq("id", client.program_id)
        .maybeSingle();

      if (!program) continue;

      const { data: existingSchedule } = await supabaseAdmin
        .from("program_schedule")
        .select("id, week_number, start_date, end_date")
        .eq("client_id", client.id)
        .order("week_number");

      if (!existingSchedule || existingSchedule.length === 0) continue;

      const firstWeek = existingSchedule[0];
      if (!firstWeek.start_date) continue;

      const startDate = new Date(firstWeek.start_date);

      const updates: Array<{ id: string; start_date: string; end_date: string }> = [];

      for (let i = 0; i < existingSchedule.length; i++) {
        const week = existingSchedule[i];
        const weekStart = new Date(startDate);
        weekStart.setDate(weekStart.getDate() + i * 7);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);

        const startStr = weekStart.toISOString().split("T")[0];
        const endStr = weekEnd.toISOString().split("T")[0];

        if (week.start_date !== startStr || week.end_date !== endStr) {
          updates.push({ id: week.id, start_date: startStr, end_date: endStr });
        }
      }

      if (updates.length > 0) {
        await Promise.allSettled(
          updates.map(u =>
            supabaseAdmin
              .from("program_schedule")
              .update({ start_date: u.start_date, end_date: u.end_date })
              .eq("id", u.id),
          ),
        );
        updated++;
      }
    }

    await ctx.reply(`✅ Пересчитано расписание для ${updated} клиент(ов).`);
  } catch (err) {
    console.error(`[ADMIN] recalc_schedule error:`, err);
    await ctx.reply("Ошибка при пересчёте расписания.");
  }
}

export async function adminGenerateCodes(ctx: MyContext): Promise<void> {
  if (!isCoach(ctx)) {
    await ctx.reply(t("chat.coach_only", ctx.language));
    return;
  }

  const text = ctx.message?.text ?? "";
  const args = text.split(/\s+/).slice(1);
  const countArg = args[0];
  const requested = countArg ? parseInt(countArg, 10) || 1 : 1;
  const count = Math.min(Math.max(requested, 1), 20);

  try {
    const { data: clients, error } = await supabaseAdmin
      .from("clients")
      .select("id, name, telegram_id, connect_code")
      .is("telegram_id", null)
      .limit(count);

    if (error || !clients || clients.length === 0) {
      await ctx.reply("Нет клиентов без привязанного Telegram.");
      return;
    }

    const lines: string[] = ["🔑 Сгенерированные коды:", ""];

    for (const client of clients) {
      const code = generateCode();
      const name = escapeHtml(client.name ?? "Клиент");
      const oldCode = client.connect_code ? ` (старый: ${escapeHtml(client.connect_code)})` : "";
      lines.push(`${name}: <code>${code}</code>${oldCode}`);

      await supabaseAdmin
        .from("clients")
        .update({ connect_code: code })
        .eq("id", client.id);
    }

    if (requested > count) {
      lines.push(`\n⚠️ Запрошено ${requested}, сгенерировано ${count} (максимум).`);
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  } catch (err) {
    console.error(`[ADMIN] generate_codes error:`, err);
    await ctx.reply("Ошибка при генерации кодов.");
  }
}
