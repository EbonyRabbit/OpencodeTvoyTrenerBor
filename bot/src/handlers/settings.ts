import type { MyContext } from "../bot.js";
import type { Client } from "../lib/clients.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { t, type Language } from "../i18n/index.js";
import {
  formatSchedule,
  weekdayShortLabel,
  handleScheduleStart,
  startTrainingDaysSetup,
} from "./training-days.js";
import { getTodayDateStr, getCurrentWeekRow } from "../lib/workout-utils.js";
import { DEFAULT_TIMEZONE } from "../lib/constants.js";
import { getEffectiveTrainingDays } from "../lib/postpone-utils.js";

// ⚠️ MUST stay in sync with web/src/lib/clients.ts (TIMEZONE_LIST)
const TIMEZONE_LIST = [
  "Europe/Moscow",
  "Europe/Kiev",
  "Europe/Minsk",
  "Asia/Almaty",
  "Asia/Tashkent",
  "Asia/Astana",
  "Asia/Dubai",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
] as const;

const TIME_HOURS: readonly string[] = Array.from(
  { length: 24 },
  (_, h) => `${String(h).padStart(2, "0")}:00`,
);

const QUARTER_MINUTES = ["00", "15", "30", "45"] as const;

const TIME_PREFIXES = ["morning", "measure_time", "checkin_time"] as const;

const WEEKDAYS_ISO = [1, 2, 3, 4, 5, 6, 7];

const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

type Btn = { text: string; callback_data: string };

function clientLang(client: Client): Language {
  return client.language === "en" ? "en" : "ru";
}

function langLabel(lang: Language): string {
  return t("settings.lang_" + lang, lang);
}

function measureDayLabel(iso: number | null, lang: Language): string {
  if (iso === null || iso < 1 || iso > 31) {
    return t("settings.value_none", lang);
  }
  if (lang === "en") {
    return `${iso}${ordinalSuffix(iso)}`;
  }
  return t(`settings.measure_day_value`, lang, { day: iso });
}

function ordinalSuffix(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return "th";
  switch (day % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

function weekdayLabel(iso: number | null, lang: Language): string {
  if (iso === null || iso < 1 || iso > 7) {
    return t("settings.value_none", lang);
  }
  return t(`schedule.day_fullnames.${String(iso)}`, lang);
}

function shortTz(value: string): string {
  const parts = value.split("/");
  return parts[parts.length - 1] ?? value;
}

function timeLabel(value: string | null | undefined, lang: Language): string {
  if (!value) return t("settings.value_none", lang);
  return value.slice(0, 5);
}

function panelText(client: Client, trainingDays: number[] | null): string {
  const lang = clientLang(client);
  const lines = [
    t("settings.title", lang),
    "",
    t("settings.lang", lang, { value: langLabel(lang) }),
    t("settings.timezone", lang, {
      value: client.timezone ?? t("settings.value_none", lang),
    }),
    t("settings.morning_time", lang, {
      value: timeLabel(client.morning_time, lang),
    }),
    t("settings.measure_day", lang, {
      value: measureDayLabel(client.measurement_day, lang),
    }),
    t("settings.measure_time", lang, {
      value: timeLabel(client.measurement_time, lang),
    }),
    t("settings.checkin_day", lang, {
      value: weekdayLabel(client.checkin_day, lang),
    }),
    t("settings.checkin_time", lang, {
      value: timeLabel(client.checkin_time, lang),
    }),
    "",
    `${t("settings.train_days", lang)}:`,
    formatSchedule(trainingDays, lang),
    "",
    t("settings.choose", lang),
  ];
  return lines.join("\n");
}

function panelKeyboard(client: Client): Btn[][] {
  const lang = clientLang(client);
  const rows: Btn[][] = [
    [{ text: t("settings.lang", lang, { value: langLabel(lang) }), callback_data: "settings_lang" }],
    [{ text: t("settings.timezone", lang, { value: client.timezone ?? t("settings.value_none", lang) }), callback_data: "settings_tz" }],
    [{ text: t("settings.morning_time", lang, { value: timeLabel(client.morning_time, lang) }), callback_data: "settings_morning" }],
    [{ text: t("settings.measure_day", lang, { value: measureDayLabel(client.measurement_day, lang) }), callback_data: "settings_measure_day" }],
    [{ text: t("settings.measure_time", lang, { value: timeLabel(client.measurement_time, lang) }), callback_data: "settings_measure_time" }],
    [{ text: t("settings.checkin_day", lang, { value: weekdayLabel(client.checkin_day, lang) }), callback_data: "settings_checkin_day" }],
    [{ text: t("settings.checkin_time", lang, { value: timeLabel(client.checkin_time, lang) }), callback_data: "settings_checkin_time" }],
  ];
  const footer: Btn[] = [];
  if (client.program_id) {
    footer.push({ text: t("settings.train_days", lang), callback_data: "settings_days" });
  }
  footer.push({ text: t("settings.close", lang), callback_data: "settings_close" });
  rows.push(footer);
  return rows;
}

function langKeyboard(lang: Language): Btn[][] {
  return [
    [
      { text: t("settings.lang_ru", lang), callback_data: "settings_lang_set:ru" },
      { text: t("settings.lang_en", lang), callback_data: "settings_lang_set:en" },
    ],
    [{ text: t("settings.back", lang), callback_data: "settings_back" }],
  ];
}

function tzKeyboard(lang: Language): Btn[][] {
  const rows: Btn[][] = [];
  for (let i = 0; i < TIMEZONE_LIST.length; i += 2) {
    rows.push([
      { text: shortTz(TIMEZONE_LIST[i]), callback_data: `settings_tz_set:${TIMEZONE_LIST[i]}` },
      ...(i + 1 < TIMEZONE_LIST.length
        ? [{ text: shortTz(TIMEZONE_LIST[i + 1]), callback_data: `settings_tz_set:${TIMEZONE_LIST[i + 1]}` }]
        : []),
    ]);
  }
  rows.push([
    { text: t("settings.off", lang), callback_data: "settings_tz_off" },
    { text: t("settings.back", lang), callback_data: "settings_back" },
  ]);
  return rows;
}

function timeHourKeyboard(lang: Language, prefix: string): Btn[][] {
  const rows: Btn[][] = [];
  for (let i = 0; i < TIME_HOURS.length; i += 6) {
    rows.push(
      TIME_HOURS.slice(i, i + 6).map((tm) => ({
        text: tm.slice(0, 2),
        callback_data: `${prefix}_hour:${tm.slice(0, 2)}`,
      })),
    );
  }
  rows.push([
    { text: t("settings.off", lang), callback_data: `${prefix}_off` },
    { text: t("settings.back", lang), callback_data: "settings_back" },
  ]);
  return rows;
}

function timeMinuteKeyboard(lang: Language, prefix: string, hour: string): Btn[][] {
  const rows: Btn[][] = [
    QUARTER_MINUTES.map((mm) => ({
      text: `${hour}:${mm}`,
      callback_data: `${prefix}_set:${hour}:${mm}`,
    })),
  ];
  rows.push([{ text: t("settings.back", lang), callback_data: `${prefix}_hours` }]);
  return rows;
}

function measureDayKeyboard(lang: Language): Btn[][] {
  const rows: Btn[][] = [];
  for (let i = 0; i < MONTH_DAYS.length; i += 6) {
    rows.push(
      MONTH_DAYS.slice(i, i + 6).map((day) => ({
        text: String(day),
        callback_data: `settings_measure_day_set:${day}`,
      })),
    );
  }
  rows.push([{ text: t("settings.back", lang), callback_data: "settings_back" }]);
  return rows;
}

function weekdayKeyboard(lang: Language, prefix: string): Btn[][] {
  const rows: Btn[][] = [];
  for (let i = 0; i < WEEKDAYS_ISO.length; i += 3) {
    rows.push(
      WEEKDAYS_ISO.slice(i, i + 3).map((iso) => ({
        text: weekdayShortLabel(iso, lang),
        callback_data: `${prefix}_set:${iso}`,
      })),
    );
  }
  rows.push([
    { text: t("settings.off", lang), callback_data: `${prefix}_off` },
    { text: t("settings.back", lang), callback_data: "settings_back" },
  ]);
  return rows;
}

function isNotModified(err: unknown): boolean {
  return err instanceof Error && /message is not modified/i.test(err.message);
}

async function editOrSend(
  ctx: MyContext,
  text: string,
  keyboard: Btn[][],
): Promise<void> {
  try {
    await ctx.editMessageText(text, { reply_markup: { inline_keyboard: keyboard } });
  } catch (err) {
    if (isNotModified(err)) return;
    try {
      await ctx.reply(text, { reply_markup: { inline_keyboard: keyboard } });
    } catch {
      // fallback reply failed
    }
  }
}

async function effectiveDays(client: Client): Promise<number[] | null> {
  if (!client.program_id) return client.training_days;

  const tz = client.timezone || DEFAULT_TIMEZONE;
  const todayStr = getTodayDateStr(tz);
  const weekRow = await getCurrentWeekRow(client, todayStr);

  return getEffectiveTrainingDays(client, weekRow);
}

async function renderPanel(ctx: MyContext, client: Client): Promise<void> {
  const trainingDays = await effectiveDays(client);
  await editOrSend(ctx, panelText(client, trainingDays), panelKeyboard(client));
}

async function openEditor(ctx: MyContext, which: string): Promise<void> {
  const client = ctx.client;
  if (!client) return;
  const lang = clientLang(client);
  const editors: Record<string, { text: string; keyboard: Btn[][] }> = {
    lang: { text: t("settings.edit_lang", lang), keyboard: langKeyboard(lang) },
    tz: { text: t("settings.edit_tz", lang), keyboard: tzKeyboard(lang) },
    morning: { text: t("settings.edit_morning", lang), keyboard: timeHourKeyboard(lang, "settings_morning") },
    measure_day: { text: t("settings.edit_measure_day", lang), keyboard: measureDayKeyboard(lang) },
    measure_time: { text: t("settings.edit_measure_time", lang), keyboard: timeHourKeyboard(lang, "settings_measure_time") },
    checkin_day: { text: t("settings.edit_checkin_day", lang), keyboard: weekdayKeyboard(lang, "settings_checkin_day") },
    checkin_time: { text: t("settings.edit_checkin_time", lang), keyboard: timeHourKeyboard(lang, "settings_checkin_time") },
  };
  const editor = editors[which];
  if (!editor) return;
  await editOrSend(ctx, editor.text, editor.keyboard);
}

type SettingsPatch = Partial<
  Pick<
    Client,
    | "language"
    | "timezone"
    | "morning_time"
    | "measurement_time"
    | "measurement_day"
    | "checkin_day"
    | "checkin_time"
  >
>;

async function saveClient(clientId: string, patch: SettingsPatch): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("clients")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", clientId);
  if (error) {
    console.error(`[SETTINGS] Save error for ${clientId}:`, error.message);
    return false;
  }
  return true;
}

async function applyPatch(
  ctx: MyContext,
  patch: SettingsPatch,
): Promise<void> {
  const client = ctx.client;
  if (!client) return;
  await ctx.answerCallbackQuery().catch(() => {});
  const ok = await saveClient(client.id, patch);
  if (!ok) {
    await ctx.reply(t("settings.save_error", clientLang(client))).catch(() => {});
    return;
  }
  Object.assign(client, patch);
  await renderPanel(ctx, client);
}

export async function settingsHandler(ctx: MyContext): Promise<void> {
  const client = ctx.client;
  if (!client) {
    await ctx.reply(t("greeting.session_expired", ctx.language));
    return;
  }
  const trainingDays = await effectiveDays(client);
  await ctx.reply(panelText(client, trainingDays), {
    reply_markup: { inline_keyboard: panelKeyboard(client) },
  });
}

export async function handleSettingsCallback(
  ctx: MyContext,
  data: string,
): Promise<void> {
  const client = ctx.client;
  if (!client) return;

  if (
    data === "settings_lang" ||
    data === "settings_tz" ||
    data === "settings_morning" ||
    data === "settings_measure_day" ||
    data === "settings_measure_time" ||
    data === "settings_checkin_day" ||
    data === "settings_checkin_time"
  ) {
    await ctx.answerCallbackQuery().catch(() => {});
    await openEditor(ctx, data.slice("settings_".length));
    return;
  }

  if (data === "settings_back") {
    await ctx.answerCallbackQuery().catch(() => {});
    await renderPanel(ctx, client);
    return;
  }

  const timePrefixMatch = data.match(/^settings_(morning|measure_time|checkin_time)_hour:(\d{2})$/);
  if (timePrefixMatch) {
    await ctx.answerCallbackQuery().catch(() => {});
    const [, prefix, hour] = timePrefixMatch;
    if (!/^([01]\d|2[0-3])$/.test(hour)) return;
    const lang = clientLang(client);
    const editorTexts: Record<string, string> = {
      morning: "settings.edit_morning",
      measure_time: "settings.edit_measure_time",
      checkin_time: "settings.edit_checkin_time",
    };
    await editOrSend(
      ctx,
      t(editorTexts[prefix], lang) + `\n\n${hour}:00 — ${hour}:45`,
      timeMinuteKeyboard(lang, `settings_${prefix}`, hour),
    );
    return;
  }

  const timeHoursBack = data.match(/^settings_(morning|measure_time|checkin_time)_hours$/);
  if (timeHoursBack) {
    await ctx.answerCallbackQuery().catch(() => {});
    const [, prefix] = timeHoursBack;
    const lang = clientLang(client);
    const titleTexts: Record<string, string> = {
      morning: "settings.edit_morning",
      measure_time: "settings.edit_measure_time",
      checkin_time: "settings.edit_checkin_time",
    };
    await editOrSend(
      ctx,
      t(titleTexts[prefix], lang),
      timeHourKeyboard(lang, `settings_${prefix}`),
    );
    return;
  }

  if (data === "settings_days") {
    await ctx.answerCallbackQuery().catch(() => {});
    const tz = client.timezone || DEFAULT_TIMEZONE;
    const todayStr = getTodayDateStr(tz);
    const weekRow = await getCurrentWeekRow(client, todayStr);
    if (weekRow?.training_days) {
      await startTrainingDaysSetup(ctx, { id: weekRow.id, trainingDays: weekRow.training_days });
    } else {
      await handleScheduleStart(ctx);
    }
    return;
  }

  if (data === "settings_close") {
    await ctx.answerCallbackQuery().catch(() => {});
    try {
      await ctx.editMessageText(t("settings.closed", clientLang(client)), {
        reply_markup: { inline_keyboard: [] },
      });
    } catch {
      // message may be gone
    }
    return;
  }

  if (data.startsWith("settings_lang_set:")) {
    const code = data.slice("settings_lang_set:".length);
    if (code !== "ru" && code !== "en") {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }
    await applyPatch(ctx, { language: code });
    return;
  }

  if (data.startsWith("settings_tz_set:")) {
    const zone = data.slice("settings_tz_set:".length);
    if (!(TIMEZONE_LIST as readonly string[]).includes(zone)) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }
    await applyPatch(ctx, { timezone: zone });
    return;
  }

  if (data === "settings_tz_off") {
    await applyPatch(ctx, { timezone: null });
    return;
  }

  if (data.startsWith("settings_morning_set:")) {
    const tm = data.slice("settings_morning_set:".length);
    if (!/^([01]\d|2[0-3]):(00|15|30|45)$/.test(tm)) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }
    await applyPatch(ctx, { morning_time: tm });
    return;
  }

  if (data === "settings_morning_off") {
    await applyPatch(ctx, { morning_time: null });
    return;
  }

  if (data.startsWith("settings_measure_time_set:")) {
    const tm = data.slice("settings_measure_time_set:".length);
    if (!/^([01]\d|2[0-3]):(00|15|30|45)$/.test(tm)) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }
    await applyPatch(ctx, { measurement_time: tm });
    return;
  }

  if (data === "settings_measure_time_off") {
    await applyPatch(ctx, { measurement_time: null });
    return;
  }

  if (data.startsWith("settings_measure_day_set:")) {
    const day = Number(data.slice("settings_measure_day_set:".length));
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }
    await applyPatch(ctx, { measurement_day: day });
    return;
  }

  if (data.startsWith("settings_checkin_day_set:")) {
    const iso = Number(data.slice("settings_checkin_day_set:".length));
    if (!Number.isInteger(iso) || iso < 1 || iso > 7) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }
    await applyPatch(ctx, { checkin_day: iso });
    return;
  }

  if (data.startsWith("settings_checkin_time_set:")) {
    const tm = data.slice("settings_checkin_time_set:".length);
    if (!/^([01]\d|2[0-3]):(00|15|30|45)$/.test(tm)) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }
    await applyPatch(ctx, { checkin_time: tm });
    return;
  }

  if (data === "settings_checkin_time_off") {
    await applyPatch(ctx, { checkin_time: null });
    return;
  }

  if (data === "settings_checkin_day_off") {
    await applyPatch(ctx, { checkin_day: null });
    return;
  }
}
