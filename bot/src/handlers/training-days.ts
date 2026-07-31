import type { MyContext } from "../bot.js";
import type { Client } from "../lib/clients.js";
import { getWorkoutPlan } from "../lib/workout-utils.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { setState, getState, clearState } from "../state/machine.js";
import { t, type Language } from "../i18n/index.js";

export const WEEKDAYS_ISO = [1, 2, 3, 4, 5, 6, 7] as const;

export interface ScheduleSelection {
  [order: string]: number;
}

function weekdayLabel(iso: number, lang: Language): string {
  return t(`schedule.day_fullnames.${String(iso)}`, lang);
}

function weekdayShortLabel(iso: number, lang: Language): string {
  return t(`schedule.day_names.${String(iso)}`, lang);
}

export function formatSchedule(days: number[] | null, lang: Language): string {
  if (!days || days.length === 0) return "—";
  return days
    .map((iso, i) => `${i + 1}. ${weekdayLabel(iso, lang)}`)
    .join("\n");
}

export async function getProgramDayOrders(client: Client): Promise<number[] | null> {
  if (!client.program_id) return null;

  const plan = await getWorkoutPlan(client, 1);
  if (!plan?.days?.length) return null;

  const orders = plan.days
    .filter((d) => (d.exercises?.length ?? 0) > 0)
    .map((d) => d.day_order)
    .sort((a, b) => a - b);

  return orders.length > 0 ? orders : null;
}

function buildDayPickKeyboard(
  selected: ScheduleSelection,
  lang: Language,
): { text: string; callback_data: string }[][] {
  const used = new Set(Object.values(selected));
  const rows: { text: string; callback_data: string }[][] = [];

  const row: { text: string; callback_data: string }[] = [];
  for (const iso of WEEKDAYS_ISO) {
    if (used.has(iso)) continue;
    row.push({
      text: weekdayShortLabel(iso, lang),
      callback_data: `sched_sel:${iso}`,
    });
    if (row.length === 4) {
      rows.push(row);
      row.length = 0;
    }
  }
  if (row.length > 0) rows.push(row);

  rows.push([{ text: t("schedule.btn_cancel", lang), callback_data: "sched_cancel" }]);
  return rows;
}

async function sendDayPick(
  ctx: MyContext,
  order: number,
  selected: ScheduleSelection,
): Promise<void> {
  const msg = t("schedule.prompt_day", ctx.language, { order: String(order) });
  await ctx.reply(msg, {
    reply_markup: { inline_keyboard: buildDayPickKeyboard(selected, ctx.language) },
  });
}

async function saveSchedule(ctx: MyContext, selected: ScheduleSelection): Promise<boolean> {
  if (!ctx.client || !ctx.from?.id) return false;

  const entries = Object.entries(selected)
    .map(([order, iso]) => ({ order: Number(order), iso }))
    .sort((a, b) => a.order - b.order);
  const trainingDays = entries.map((e) => e.iso);

  const { error } = await supabaseAdmin
    .from("clients")
    .update({ training_days: trainingDays, updated_at: new Date().toISOString() })
    .eq("id", ctx.client.id);

  if (error) {
    console.error(`[SCHEDULE] Save error for ${ctx.from.id}:`, error.message);
    return false;
  }

  ctx.client.training_days = trainingDays;
  return true;
}

export async function startTrainingDaysSetup(ctx: MyContext): Promise<void> {
  if (!ctx.client || !ctx.from?.id) return;

  const orders = await getProgramDayOrders(ctx.client);
  if (!orders) {
    await ctx.reply(t("schedule.no_program", ctx.language));
    return;
  }

  const selected: ScheduleSelection = {};

  try {
    await setState(ctx.from.id, {
      action: "training_days",
      step: "pick",
      data: { sched_orders: orders, sched_order: orders[0], sched_selected: selected },
    });
  } catch (err) {
    console.warn(`[SCHEDULE] setState failed for ${ctx.from.id}:`, err);
  }

  await ctx.reply(
    t("schedule.setup_description", ctx.language, { count: String(orders.length) }),
  );
  await sendDayPick(ctx, orders[0], selected);
}

export async function scheduleHandler(ctx: MyContext): Promise<void> {
  if (!ctx.client) {
    await ctx.reply(t("error.user_not_identified", ctx.language));
    return;
  }

  const orders = await getProgramDayOrders(ctx.client);
  if (!orders) {
    await ctx.reply(t("schedule.no_program", ctx.language));
    return;
  }

  if (ctx.client.training_days && ctx.client.training_days.length > 0) {
    await ctx.reply(t("schedule.already_set", ctx.language, {
      days: formatSchedule(ctx.client.training_days, ctx.language),
    }), {
      reply_markup: {
        inline_keyboard: [[
          { text: t("schedule.change", ctx.language), callback_data: "sched_start" },
        ]],
      },
    });
    return;
  }

  await startTrainingDaysSetup(ctx);
}

export async function handleScheduleStart(ctx: MyContext): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  if (ctx.from?.id) {
    try {
      await clearState(ctx.from.id);
    } catch (err) {
      console.warn(`[SCHEDULE] clearState failed for ${ctx.from.id}:`, err);
    }
  }
  await startTrainingDaysSetup(ctx);
}

export async function handleSchedulePick(ctx: MyContext, isoRaw: string): Promise<void> {
  const iso = Number(isoRaw);
  if (!WEEKDAYS_ISO.includes(iso as (typeof WEEKDAYS_ISO)[number])) {
    await ctx.answerCallbackQuery({ text: t("error.invalid_exercise_index", ctx.language), show_alert: true }).catch(() => {});
    return;
  }
  if (!ctx.client || !ctx.from?.id) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  await ctx.answerCallbackQuery().catch(() => {});

  const current = await getState(ctx.from.id);
  const data = current?.data ?? {};
  const orders = (data.sched_orders as number[] | undefined) ?? [];
  const selected = (data.sched_selected ?? {}) as ScheduleSelection;
  const order = Number(data.sched_order ?? (orders[0] ?? 1));

  if (Object.values(selected).includes(iso)) {
    await sendDayPick(ctx, order, selected);
    return;
  }

  selected[String(order)] = iso;

  const nextOrder = orders.find((o) => !selected[String(o)]);
  if (nextOrder !== undefined) {
    try {
      await setState(ctx.from.id, {
        action: "training_days",
        step: "pick",
        data: { sched_orders: orders, sched_order: nextOrder, sched_selected: selected },
      });
    } catch (err) {
      console.warn(`[SCHEDULE] setState failed for ${ctx.from.id}:`, err);
    }
    await sendDayPick(ctx, nextOrder, selected);
    return;
  }

  const saved = await saveSchedule(ctx, selected);
  if (!saved) {
    await ctx.reply(t("error.service_unavailable", ctx.language));
    return;
  }

  try {
    await clearState(ctx.from.id);
  } catch (err) {
    console.warn(`[SCHEDULE] clearState failed for ${ctx.from.id}:`, err);
  }

  const trainingDays = orders.map((o) => selected[String(o)]);
  await ctx.reply(t("schedule.done", ctx.language, {
    days: formatSchedule(trainingDays, ctx.language),
  }));
}

export async function handleScheduleCancel(ctx: MyContext): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  if (ctx.from?.id) {
    try {
      await clearState(ctx.from.id);
    } catch (err) {
      console.warn(`[SCHEDULE] clearState failed for ${ctx.from.id}:`, err);
    }
  }
  await ctx.reply(t("schedule.cancelled", ctx.language));
}
