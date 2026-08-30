import type { MyContext } from "../bot.js";
import type { Client } from "../lib/clients.js";
import { getWorkoutPlan } from "../lib/workout-utils.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { setState, getState, clearState } from "../state/machine.js";
import { t, type Language } from "../i18n/index.js";

export const WEEKDAYS_ISO = [1, 2, 3, 4, 5, 6, 7] as const;

function weekdayLabel(iso: number, lang: Language): string {
  return t(`schedule.day_fullnames.${String(iso)}`, lang);
}

export function weekdayShortLabel(iso: number, lang: Language): string {
  return t(`schedule.day_names.${String(iso)}`, lang);
}

export function formatSchedule(days: number[] | null, lang: Language): string {
  if (!days || days.length === 0) return "-";
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

type ScheduleStateData = {
  sched_orders: number[];
  sched_selected: number[];
  sched_week_id: string | null;
  [key: string]: unknown;
};

function readScheduleData(state: { data?: unknown } | null | undefined): ScheduleStateData {
  const data = (state?.data ?? {}) as Partial<ScheduleStateData>;
  return {
    sched_orders: Array.isArray(data.sched_orders) ? data.sched_orders : [],
    sched_selected: Array.isArray(data.sched_selected) ? data.sched_selected : [],
    sched_week_id: typeof data.sched_week_id === "string" ? data.sched_week_id : null,
  };
}

function buildEditorKeyboard(
  selected: number[],
  lang: Language,
): { text: string; callback_data: string }[][] {
  const selectedSet = new Set(selected);
  const rows: { text: string; callback_data: string }[][] = [];

  for (const iso of WEEKDAYS_ISO) {
    const mark = selectedSet.has(iso) ? "✅" : "⚪️";
    rows.push([
      { text: `${mark} ${weekdayShortLabel(iso, lang)}`, callback_data: `sched_toggle:${iso}` },
    ]);
  }

  rows.push([
    { text: t("schedule.btn_done", lang), callback_data: "sched_done" },
    { text: t("schedule.btn_cancel", lang), callback_data: "sched_cancel" },
  ]);

  return rows;
}

function buildEditorText(
  ordersCount: number,
  selected: number[],
  lang: Language,
): string {
  const lines = [
    t("schedule.setup_description", lang, { count: ordersCount }),
    "",
    t("schedule.selected_count", lang, {
      selected: String(selected.length),
      total: String(ordersCount),
    }),
  ];
  return lines.join("\n");
}

async function sendEditor(
  ctx: MyContext,
  orders: number[],
  selected: number[],
): Promise<void> {
  await ctx.reply(buildEditorText(orders.length, selected, ctx.language), {
    reply_markup: { inline_keyboard: buildEditorKeyboard(selected, ctx.language) },
  });
}

export function finalizeSchedule(selected: number[]): number[] {
  return [...selected].sort((a, b) => a - b);
}

async function saveSchedule(ctx: MyContext, trainingDays: number[]): Promise<boolean> {
  if (!ctx.client || !ctx.from?.id) return false;

  const now = new Date().toISOString();

  const clientUpdate = supabaseAdmin
    .from("clients")
    .update({ training_days: trainingDays, updated_at: now })
    .eq("id", ctx.client.id);

  const scheduleUpdate = supabaseAdmin
    .from("program_schedule")
    .update({ training_days: trainingDays, updated_at: now })
    .eq("client_id", ctx.client.id);

  const [clientResult, scheduleResult] = await Promise.all([clientUpdate, scheduleUpdate]);

  if (clientResult.error || scheduleResult.error) {
    console.error(
      `[SCHEDULE] Save error for ${ctx.from.id}:`,
      clientResult.error?.message ?? scheduleResult.error?.message,
    );
    return false;
  }

  ctx.client.training_days = trainingDays;
  return true;
}

export async function startTrainingDaysSetup(
  ctx: MyContext,
  weekOverride?: { id: string; trainingDays: number[] } | null,
): Promise<boolean> {
  if (!ctx.client || !ctx.from?.id) return false;

  const orders = await getProgramDayOrders(ctx.client);
  if (!orders) {
    await ctx.reply(t("schedule.no_program", ctx.language));
    return false;
  }

  const data: ScheduleStateData = {
    sched_orders: orders,
    sched_selected: weekOverride ? [...weekOverride.trainingDays] : [],
    sched_week_id: weekOverride?.id ?? null,
  };

  try {
    await setState(ctx.from.id, {
      action: "training_days",
      step: "pick",
      data,
    });
  } catch (err) {
    console.warn(`[SCHEDULE] setState failed for ${ctx.from.id}:`, err);
  }

  await sendEditor(ctx, orders, data.sched_selected);
  return true;
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

export async function handleScheduleToggle(ctx: MyContext, isoRaw: string): Promise<void> {
  const iso = Number(isoRaw);
  if (!WEEKDAYS_ISO.includes(iso as (typeof WEEKDAYS_ISO)[number])) {
    await ctx.answerCallbackQuery({ text: t("error.invalid_exercise_index", ctx.language), show_alert: true }).catch(() => {});
    return;
  }
  if (!ctx.client || !ctx.from?.id) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  const { sched_orders: orders, sched_selected: selected, sched_week_id: weekId } = readScheduleData(ctx.state);

  if (orders.length === 0) {
    await ctx.answerCallbackQuery({ text: t("schedule.expired", ctx.language), show_alert: true }).catch(() => {});
    return;
  }

  const index = selected.indexOf(iso);
  const nextSelected = index === -1 ? [...selected, iso] : selected.filter((d) => d !== iso);

  try {
    await setState(ctx.from.id, {
      action: "training_days",
      step: "pick",
      data: { sched_orders: orders, sched_selected: nextSelected, sched_week_id: weekId },
    });
  } catch (err) {
    console.warn(`[SCHEDULE] setState failed for ${ctx.from.id}:`, err);
    await ctx.answerCallbackQuery({ text: t("error.service_unavailable", ctx.language), show_alert: true }).catch(() => {});
    return;
  }

  await ctx.answerCallbackQuery().catch(() => {});

  try {
    await ctx.editMessageText(buildEditorText(orders.length, nextSelected, ctx.language), {
      reply_markup: { inline_keyboard: buildEditorKeyboard(nextSelected, ctx.language) },
    });
  } catch (err) {
    console.warn(`[SCHEDULE] editMessageText failed for ${ctx.from.id}:`, err);
    await sendEditor(ctx, orders, nextSelected);
  }
}

export async function handleScheduleDone(ctx: MyContext): Promise<void> {
  if (!ctx.client || !ctx.from?.id) {
    await ctx.answerCallbackQuery().catch(() => {});
    return;
  }

  const { sched_orders: orders, sched_selected: selected, sched_week_id: weekId } = readScheduleData(ctx.state);

  if (orders.length === 0) {
    await ctx.answerCallbackQuery({ text: t("schedule.expired", ctx.language), show_alert: true }).catch(() => {});
    return;
  }

  if (selected.length !== orders.length) {
    await ctx.answerCallbackQuery({
      text: t("schedule.need_exact", ctx.language, {
        count: orders.length,
        selected: String(selected.length),
      }),
      show_alert: true,
    }).catch(() => {});
    return;
  }

  const trainingDays = finalizeSchedule(selected);

  const saved = await saveSchedule(ctx, trainingDays);
  if (!saved) {
    await ctx.answerCallbackQuery({ text: t("error.service_unavailable", ctx.language), show_alert: true }).catch(() => {});
    return;
  }

  await ctx.answerCallbackQuery().catch(() => {});

  try {
    await clearState(ctx.from.id);
  } catch (err) {
    console.warn(`[SCHEDULE] clearState failed for ${ctx.from.id}:`, err);
  }

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
