import { supabaseAdmin } from "./supabase-admin.js";
import type { Client } from "./clients.js";
import { getParsedContent, flattenLoggableExercises, getCompositeLetters, type ParsedExercise, type ParsedDay } from "./program-utils.js";
import { getEffectiveTrainingDays, weekdayDateInWeek } from "./postpone-utils.js";
import { t, type Language } from "../i18n/index.js";
import { DEFAULT_TIMEZONE } from "./constants.js";
import { isPseudoExercise } from "./log-markers.js";

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export interface WorkoutPlan {
  week_number: number;
  is_deload: boolean;
  goal: string | null;
  days: ParsedDay[];
}

export type TodayWorkout = WorkoutPlan & {
  day_name: string;
  day_order: number | null;
  exercises: ParsedExercise[];
};

export interface CurrentWeekRow {
  id: string;
  week_number: number;
  start_date: string | null;
  end_date: string | null;
  is_deload: boolean;
  focus: string | null;
  training_days: number[] | null;
}

export async function getCurrentWeekRow(
  client: Client,
  todayStr: string,
): Promise<CurrentWeekRow | null> {
  const { data, error } = await supabaseAdmin
    .from("program_schedule")
    .select("id, week_number, start_date, end_date, is_deload, focus, training_days")
    .eq("client_id", client.id);

  if (error) {
    console.error(`[WORKOUT] Schedule query error for ${client.id}:`, error.message);
    return null;
  }

  return (
    (data ?? []).find(
      (w) => w.start_date && w.end_date && todayStr >= w.start_date && todayStr <= w.end_date,
    ) ?? null
  );
}

interface WorkoutSender {
  reply: (text: string, options?: Record<string, unknown>) => Promise<unknown>;
  language: Language;
}

function getTodayDayName(timezone: string): string {
  const formatter = new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    timeZone: timezone,
  });
  return formatter.format(new Date()).toLowerCase();
}

export function getTodayDateStr(timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
  });
  return formatter.format(new Date());
}

export async function getWorkoutPlan(
  client: Client,
  scheduleWeek: number,
  scheduleContext?: { is_deload: boolean; focus: string | null },
): Promise<WorkoutPlan | null> {
  if (!client.program_id) return null;

  let scheduleData = scheduleContext;

  if (!scheduleData) {
    const { data, error } = await supabaseAdmin
      .from("program_schedule")
      .select("is_deload, focus")
      .eq("client_id", client.id)
      .eq("week_number", scheduleWeek)
      .maybeSingle();

    if (error) {
      console.error(`[WORKOUT] Schedule query error for ${client.id}:`, error.message);
      return null;
    }

    if (!data) return null;
    scheduleData = data;
  }

  const { data: program, error: programError } = await supabaseAdmin
    .from("programs")
    .select("parsed_content")
    .eq("id", client.program_id)
    .maybeSingle();

  if (programError) {
    console.error(`[WORKOUT] Program query error for ${client.id}:`, programError.message);
    return null;
  }

  const parsed = getParsedContent(program?.parsed_content ?? null);
  if (!parsed) return null;

  const weekData = parsed.weeks?.find((w) => w.week_number === scheduleWeek);
  if (!weekData?.days) return null;

  return {
    week_number: scheduleWeek,
    is_deload: scheduleData.is_deload,
    goal: scheduleData.focus,
    days: weekData.days,
  };
}

export async function getOccupiedDaysForWeek(
  client: Client,
  weekRow: CurrentWeekRow,
): Promise<number[]> {
  const effective = getEffectiveTrainingDays(client, weekRow);
  if (effective && effective.length > 0) return effective;

  const plan = await getWorkoutPlan(client, weekRow.week_number, {
    is_deload: weekRow.is_deload,
    focus: weekRow.focus,
  });
  if (!plan?.days?.length) return [];

  const occupied = new Set<number>();
  for (const day of [...plan.days].sort((a, b) => a.day_order - b.day_order)) {
    const iso = weekdayIsoFromName(day.day_name);
    if (iso < 1) continue;
    const date = weekdayDateInWeek(weekRow.start_date ?? "", weekRow.end_date, iso);
    if (date) occupied.add(iso);
  }
  return [...occupied];
}

const isoDayFormatterCache = new Map<string, Intl.DateTimeFormat>();

export function getTodayISODay(timezone: string): number {
  let formatter = isoDayFormatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: timezone,
    });
    isoDayFormatterCache.set(timezone, formatter);
  }
  const dayName = formatter.format(new Date()).toLowerCase();
  const dayMap: Record<string, number> = {
    monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
    friday: 5, saturday: 6, sunday: 7,
  };
  return dayMap[dayName] ?? 0;
}

export function parseTimeRounded(timeStr: string): { hour: number; minute: number } | null {
  if (!timeStr) return null;
  const parts = timeStr.split(":");
  if (parts.length < 2) return null;
  const hour = parseInt(parts[0], 10);
  const minute = parseInt(parts[1], 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const roundedMinute = Math.round(minute / 15) * 15;
  if (roundedMinute >= 60) {
    if (hour === 23) return { hour: 23, minute: 45 };
    return { hour: hour + 1, minute: 0 };
  }
  return { hour, minute: roundedMinute };
}

const isoDayOfMonthFormatterCache = new Map<string, Intl.DateTimeFormat>();

export function getTodayDayOfMonth(timezone: string): number {
  let formatter = isoDayOfMonthFormatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      timeZone: timezone,
    });
    isoDayOfMonthFormatterCache.set(timezone, formatter);
  }
  const day = parseInt(formatter.format(new Date()), 10);
  return Number.isNaN(day) ? 0 : day;
}

export function getIsoWeekday(dateStr: string): number {
  const date = new Date(`${dateStr}T12:00:00Z`);
  if (isNaN(date.getTime())) return 0;
  const iso = date.getUTCDay();
  return iso === 0 ? 7 : iso;
}

const RU_DAY_NAME_TO_ISO: Record<string, number> = {
  понедельник: 1,
  вторник: 2,
  среда: 3,
  четверг: 4,
  пятница: 5,
  суббота: 6,
  воскресенье: 7,
};

export function weekdayIsoFromName(dayName: string): number {
  const normalized = dayName.trim().toLowerCase();
  if (!normalized) return 0;
  const exact = RU_DAY_NAME_TO_ISO[normalized];
  if (exact) return exact;
  for (const [name, iso] of Object.entries(RU_DAY_NAME_TO_ISO)) {
    if (normalized.includes(name)) return iso;
  }
  return 0;
}

export function plannedDateForDay(weekStartDate: string, dayName: string): string | null {
  const iso = weekdayIsoFromName(dayName);
  if (iso < 1) return null;
  return weekdayDateInWeek(weekStartDate, null, iso);
}

function weekdayFullName(iso: number, lang: Language): string {
  return t(`schedule.day_fullnames.${String(iso)}`, lang);
}

export async function getTodayWorkout(client: Client, lang: Language = "ru"): Promise<TodayWorkout | null> {
  if (!client.program_id) return null;

  const tz = client.timezone || DEFAULT_TIMEZONE;
  const todayName = getTodayDayName(tz);
  const todayStr = getTodayDateStr(tz);

  const currentWeekRow = await getCurrentWeekRow(client, todayStr);

  if (!currentWeekRow) return null;

  const plan = await getWorkoutPlan(client, currentWeekRow.week_number, {
    is_deload: currentWeekRow.is_deload,
    focus: currentWeekRow.focus,
  });
  if (!plan) return null;

  const trainingDays = getEffectiveTrainingDays(client, currentWeekRow);

  const matchedDay = matchDayForToday(plan.days, trainingDays, todayName, tz);

  if (!matchedDay?.exercises?.length) return null;

  const scheduledIsoDay = (trainingDays?.length ?? 0) > 0 ? getTodayISODay(tz) : null;

  return {
    ...plan,
    day_name: scheduledIsoDay ? weekdayFullName(scheduledIsoDay, lang) : matchedDay.day_name,
    day_order: matchedDay.day_order ?? null,
    goal: matchedDay.focus ?? null,
    exercises: matchedDay.exercises,
  };
}

export function dayOrderForDate(
  dateStr: string,
  trainingDays: number[] | null,
): number | null {
  if (!trainingDays || trainingDays.length === 0) return null;
  const iso = getIsoWeekday(dateStr);
  if (iso === 0) return null;
  const index = trainingDays.indexOf(iso);
  if (index === -1) return null;
  return index + 1;
}

export function matchDayByOrder(
  days: ParsedDay[],
  dayOrder: number,
): ParsedDay | null {
  return days.find((d) => d.day_order === dayOrder) ?? null;
}

function matchDayForToday(
  days: ParsedDay[],
  trainingDays: number[] | null,
  todayName: string,
  tz: string,
): ParsedDay | null {
  if (trainingDays && trainingDays.length > 0) {
    const todayISO = getTodayISODay(tz);
    const dayIndex = trainingDays.indexOf(todayISO);
    if (dayIndex === -1) return null;
    const dayOrder = dayIndex + 1;
    const matched = days.find((d) => d.day_order === dayOrder);
    if (matched) return matched;
  }

  return days.find((d) => {
    const normalizedName = d.day_name.toLowerCase();
    return normalizedName.includes(todayName);
  }) ?? null;
}

export interface PreviousLog {
  weight: number | null;
  sets: number | null;
  reps: string | null;
  rounds: number | null;
  duration_sec: number | null;
  distance_km: number | null;
  pace: string | null;
  heart_rate: number | null;
}

export function isPseudoName(name: string): boolean {
  return isPseudoExercise(name);
}

function escapeLikeValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/\*/g, "\\*");
}

function postgrestValue(value: string): string {
  if (/[(),"]/.test(value)) {
    const doubled = value.replace(/\\/g, "\\\\");
    return `"${doubled.replace(/"/g, '\\"')}"`;
  }
  return escapeLikeValue(value);
}

const LAST_LOGS_CACHE_TTL_MS = 30_000;
const LAST_LOGS_CACHE_MAX_SIZE = 100;
const lastLogsCache = new Map<string, { at: number; value: Map<string, PreviousLog> }>();

function cacheKey(clientId: string, names: string[]): string {
  return `${clientId}:${[...names].sort().join("|")}`;
}

function cacheSet(key: string, value: Map<string, PreviousLog>): void {
  if (lastLogsCache.size >= LAST_LOGS_CACHE_MAX_SIZE) {
    const oldest = lastLogsCache.keys().next();
    if (!oldest.done) lastLogsCache.delete(oldest.value);
  }
  lastLogsCache.set(key, { at: Date.now(), value });
}

export async function getPreviousWorkoutLogs(
  client: Client,
  exerciseNames: string[],
): Promise<Map<string, PreviousLog>> {
  const result = new Map<string, PreviousLog>();
  const wanted = new Set(
    exerciseNames.map((n) => n.trim().toLowerCase()).filter(Boolean),
  );
  if (wanted.size === 0) return result;

  const key = cacheKey(client.id, Array.from(wanted));
  const cached = lastLogsCache.get(key);
  if (cached && Date.now() - cached.at < LAST_LOGS_CACHE_TTL_MS) {
    return cached.value;
  }

  const tz = client.timezone || DEFAULT_TIMEZONE;
  const todayStr = getTodayDateStr(tz);

  const orFilter = Array.from(wanted).map(postgrestValue).map((n) => `exercise.ilike.${n}`).join(",");

  const { data, error } = await supabaseAdmin
    .from("workout_logs")
    .select("exercise, date, sets, reps, weight, rounds, duration_sec, distance_km, pace, heart_rate")
    .eq("client_id", client.id)
    .lt("date", todayStr)
    .or(orFilter)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    console.error(`[WORKOUT] Previous logs query error for ${client.id}:`, error.message);
    return result;
  }

  for (const row of data ?? []) {
    const name = row.exercise?.trim().toLowerCase() ?? "";
    if (!name || isPseudoName(name) || !wanted.has(name)) continue;
    if (result.has(name)) continue;
    result.set(name, {
      weight: row.weight,
      sets: row.sets,
      reps: row.reps,
      rounds: row.rounds,
      duration_sec: row.duration_sec,
      distance_km: row.distance_km,
      pace: row.pace,
      heart_rate: row.heart_rate,
    });
  }

  cacheSet(key, result);
  return result;
}

function formatPreviousLog(log: PreviousLog, lang: Language): string {
  const parts: string[] = [];

  if (log.distance_km != null && log.distance_km > 0) {
    parts.push(t("workout.metric_distance", lang, { distance: log.distance_km }));
  }
  if (log.duration_sec != null && log.duration_sec > 0 && log.rounds == null) {
    parts.push(formatDuration(log.duration_sec, lang));
  }
  if (log.pace) {
    parts.push(t("workout.metric_pace", lang, { pace: log.pace }));
  }
  if (log.rounds != null) {
    parts.push(log.rounds === -1
      ? t("workout.metric_rounds_max", lang)
      : t("workout.metric_rounds", lang, { rounds: log.rounds }));
  }
  if (log.heart_rate != null) {
    parts.push(t("workout.metric_heart_rate", lang, { heart_rate: log.heart_rate }));
  }

  if (parts.length > 0) return parts.join(" · ");

  const weight =
    log.weight != null && log.weight > 0 ? `${log.weight} кг` : log.weight === 0 ? "вес тела" : null;
  const perSetList = log.reps != null && String(log.reps).includes("/");
  const setsReps = perSetList
    ? log.reps
    : log.sets != null && log.reps
      ? `${log.sets}×${log.reps}`
      : log.sets != null
        ? `${log.sets} подх.`
        : log.reps
          ? log.reps
          : null;
  return [weight, setsReps].filter(Boolean).join(" ");
}

export function formatDuration(totalSeconds: number, lang: Language = "ru"): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return m > 0
    ? t("workout.metric_duration_minutes", lang, { minutes: m })
    : t("workout.metric_duration_seconds", lang, { seconds: s });
}

function formatPlannedWeight(weight: string): string {
  return weight === "0" ? "вес тела" : `${weight} кг`;
}

function pluralizeRounds(value: string, lang: Language): string {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    const max = /^(?:МАКС|MAX|amrap)$/i.test(value.trim());
    if (max) return lang === "en" ? "MAX rounds" : "МАКС раундов";
    return lang === "en" ? `${value} rounds` : `${value} раундов`;
  }  if (lang === "en") return n === 1 ? `${value} round` : `${value} rounds`;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${value} раунд`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${value} раунда`;
  return `${value} раундов`;
}

function formatPlannedDetail(ex: ParsedExercise, lang: Language, separator = ", "): string {
  const parts: string[] = [];
  if (ex.type === "cardio") {
    if (ex.distance) parts.push(t("workout.planned_distance", lang, { distance: ex.distance }));
    if (ex.duration) parts.push(t("workout.planned_duration", lang, { duration: ex.duration }));
    if (ex.pace) parts.push(t("workout.planned_pace", lang, { pace: ex.pace }));
    if (ex.heart_rate) parts.push(t("workout.planned_heart_rate", lang, { heart_rate: ex.heart_rate }));
    return parts.join(" · ");
  }
  if (ex.sets && ex.reps) parts.push(`${ex.sets}×${ex.reps}`);
  else if (ex.sets) parts.push(`${ex.sets} подх.`);
  else if (ex.reps) parts.push(ex.reps);
  if (ex.weight) parts.push(formatPlannedWeight(ex.weight));
  if (ex.rpe) parts.push(`RPE ${ex.rpe}`);
  return parts.join(separator);
}

function formatChildLine(
  letter: string,
  child: ParsedExercise,
  lang: Language,
  last?: PreviousLog | null,
): string {
  const lines: string[] = [];
  const detail = formatPlannedDetail(child, lang, " · ");
  lines.push(`${letter}. ${child.name}${detail ? ` — ${detail}` : ""}`);
  const lastDetail = last ? formatPreviousLog(last, lang) : "";
  if (lastDetail) {
    lines.push(`   ${t("workout.exercise_last", lang, { detail: lastDetail })}`);
  }
  if (child.rest) {
    lines.push(`   ${t("workout.exercise_rest", lang, { rest: child.rest })}`);
  }
  return lines.join("\n");
}

export function formatExercise(
  index: number,
  ex: ParsedExercise,
  lang: Language,
  lastLogs: ReadonlyMap<string, PreviousLog>,
  compositeLetter = "A",
): string {
  const lines: string[] = [];

  if (ex.type === "superset" && ex.children?.length) {
    const name = ex.name ? t("workout.superset_label", lang, { name: ex.name }) : t("workout.superset_bare", lang);
    lines.push(t("workout.exercise_item", lang, { index, name }));
    for (let i = 0; i < ex.children.length; i++) {
      const child = ex.children[i];
      const last = lastLogs.get(child.name.trim().toLowerCase());
      lines.push(formatChildLine(`${compositeLetter}${i + 1}`, child, lang, last));
    }
    if (ex.rest) {
      lines.push(t("workout.exercise_rest", lang, { rest: ex.rest }));
    }
    if (ex.notes) {
      lines.push(t("workout.exercise_notes", lang, { notes: ex.notes }));
    }
    return lines.join("\n");
  }

  if (ex.type === "circuit") {
    const name = ex.name ? t("workout.circuit_label", lang, { name: ex.name }) : t("workout.circuit_bare", lang);
    lines.push(t("workout.exercise_item", lang, { index, name }));
    const children = ex.children ?? [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const last = lastLogs.get(child.name.trim().toLowerCase());
      lines.push(formatChildLine(`${compositeLetter}${i + 1}`, child, lang, last));
    }
    const goal = ex.rounds ? t("workout.circuit_goal", lang, { rounds: pluralizeRounds(ex.rounds, lang) }) : "";
    if (goal) {
      lines.push(`   ${goal}`);
    }
    const last = lastLogs.get(ex.name.trim().toLowerCase());
    if (last) {
      lines.push(`   ${t("workout.exercise_last", lang, { detail: formatPreviousLog(last, lang) })}`);
    }
    if (ex.rest) {
      lines.push(t("workout.exercise_rest", lang, { rest: ex.rest }));
    }
    if (ex.notes) {
      lines.push(t("workout.exercise_notes", lang, { notes: ex.notes }));
    }
    return lines.join("\n");
  }

  lines.push(t("workout.exercise_item", lang, { index, name: ex.name }));

  const detail = formatPlannedDetail(ex, lang);
  if (detail) lines.push(`   ${detail}`);

  const lastDetail = lastLogs.get(ex.name.trim().toLowerCase());
  if (lastDetail) {
    lines.push(`   ${t("workout.exercise_last", lang, { detail: formatPreviousLog(lastDetail, lang) })}`);
  }

  if (ex.rest) {
    lines.push(t("workout.exercise_rest", lang, { rest: ex.rest }));
  }

  if (ex.notes) {
    lines.push(t("workout.exercise_notes", lang, { notes: ex.notes }));
  }

  return lines.join("\n");
}

export function collectLoggableNames(exercises: ParsedExercise[]): string[] {
  const names: string[] = [];
  for (const ex of exercises) {
    if (ex.type === "superset" && ex.children?.length) {
      for (const child of ex.children) names.push(child.name);
      continue;
    }
    names.push(ex.name);
    if (ex.type === "circuit") {
      for (const child of ex.children ?? []) names.push(child.name);
    }
  }
  return names;
}

export async function formatWorkoutMessage(
  workout: TodayWorkout,
  lang: Language,
  client: Client,
): Promise<string> {
  const lastLogs = await getPreviousWorkoutLogs(
    client,
    collectLoggableNames(workout.exercises),
  );
  const compositeLetters = getCompositeLetters(workout.exercises);

  const lines: string[] = [];

  lines.push(t("workout.today_title", lang));
  lines.push("");

  const weekParts: string[] = [t("workout.week_label", lang, { week: workout.week_number })];
  if (workout.is_deload) weekParts.push(t("workout.deload_badge", lang));
  lines.push(weekParts.join(" | "));

  lines.push(t("workout.day_label", lang, { day: workout.day_name }));

  if (workout.goal) {
    lines.push(t("workout.goal_label", lang, { goal: workout.goal }));
  }

  lines.push("");
  lines.push(t("workout.exercises_header", lang));

  for (let i = 0; i < workout.exercises.length; i++) {
    lines.push(formatExercise(i + 1, workout.exercises[i], lang, lastLogs, compositeLetters.get(i) ?? "A"));
    lines.push("");
  }

  return lines.join("\n").trim();
}

export function formatSingleExercise(
  index: number,
  total: number,
  ex: ParsedExercise,
  lang: Language,
  lastLogs: ReadonlyMap<string, PreviousLog>,
  compositeLetter = "A",
): string {
  const lines: string[] = [];

  if (ex.type === "superset" && ex.children?.length) {
    lines.push(t("workout.exercise_header", lang, { current: index + 1, total }));
    lines.push("");
    lines.push(ex.name ? t("workout.superset_label", lang, { name: ex.name }) : t("workout.superset_bare", lang));
    if (ex.sets) {
      lines.push("");
      lines.push(t("workout.exercise_sets_reps", lang, { sets: ex.sets, reps: t("workout.superset_per_circuit", lang) }));
    }

    for (let i = 0; i < ex.children.length; i++) {
      const child = ex.children[i];
      lines.push("");
      lines.push(formatChildLine(`${compositeLetter}${i + 1}`, child, lang, lastLogs.get(child.name.trim().toLowerCase())));
    }

    if (ex.rest) {
      lines.push("");
      lines.push(t("workout.exercise_rest_detail", lang, { rest: ex.rest }));
    }
    if (ex.notes) {
      lines.push("");
      lines.push(t("workout.exercise_notes", lang, { notes: ex.notes }));
    }
    return lines.join("\n");
  }

  lines.push(t("workout.exercise_header", lang, { current: index + 1, total }));
  lines.push("");
  lines.push(
    ex.type === "circuit"
      ? ex.name ? t("workout.circuit_label", lang, { name: ex.name }) : t("workout.circuit_bare", lang)
      : ex.name,
  );

  if (ex.block) {
    lines.push("");
    lines.push(t("workout.exercise_block", lang, { block: ex.block }));
  }

  if (ex.type === "cardio") {
    const cardioLines = formatPlannedDetail(ex, lang);
    if (cardioLines) {
      lines.push("");
      lines.push(cardioLines);
    }
  } else if (ex.type === "circuit") {
    if (ex.children?.length) {
      for (let i = 0; i < ex.children.length; i++) {
        const child = ex.children[i];
        lines.push("");
        lines.push(formatChildLine(`${compositeLetter}${i + 1}`, child, lang, lastLogs.get(child.name.trim().toLowerCase())));
      }
    }

    const goal = ex.rounds ? t("workout.circuit_goal", lang, { rounds: pluralizeRounds(ex.rounds, lang) }) : "";
    if (goal) {
      lines.push("");
      lines.push(goal);
    }
  } else {
    const detail = formatPlannedDetail(ex, lang);
    if (detail) {
      lines.push("");
      lines.push(detail);
    }
  }

  if (ex.rest) {
    lines.push(t("workout.exercise_rest_detail", lang, { rest: ex.rest }));
  }

  const last = lastLogs.get(ex.name.trim().toLowerCase());
  const lastDetail = last ? formatPreviousLog(last, lang) : "";
  if (lastDetail) {
    lines.push("");
    lines.push(t("workout.exercise_last", lang, { detail: lastDetail }));
  }

  if (ex.notes) {
    lines.push("");
    lines.push(t("workout.exercise_notes", lang, { notes: ex.notes }));
  }

  return lines.join("\n");
}

export async function isTodayWorkoutCompleted(
  client: Client,
  workout?: TodayWorkout | null,
): Promise<boolean> {
  if (!client.program_id) return false;

  const effective = workout ?? await getTodayWorkout(client);
  if (!effective?.exercises?.length) return false;

  const tz = client.timezone || DEFAULT_TIMEZONE;
  const todayStr = getTodayDateStr(tz);

  const { data: logs, error } = await supabaseAdmin
    .from("workout_logs")
    .select("exercise")
    .eq("client_id", client.id)
    .eq("date", todayStr);

  if (error) {
    console.error(`[WORKOUT] Completion query error for ${client.id}:`, error.message);
    return false;
  }

  const loggedNames = new Set(
    (logs ?? [])
      .map((l) => l.exercise?.trim().toLowerCase())
      .filter((name): name is string => Boolean(name) && !isPseudoName(name)),
  );

  const targets = flattenLoggableExercises(effective.exercises);

  return targets.every((ex) =>
    loggedNames.has(ex.name.trim().toLowerCase()),
  );
}

interface MeasurementRow {
  date: string;
  weight: number | null;
  waist: number | null;
  abdomen: number | null;
  chest: number | null;
  hips: number | null;
  body_fat: number | null;
}

export function truncateMessage(message: string, suffix: string): string {
  if (message.length <= TELEGRAM_MAX_MESSAGE_LENGTH) return message;
  const limit = TELEGRAM_MAX_MESSAGE_LENGTH - suffix.length - 1;
  const truncated = message.slice(0, limit);
  const lastNewline = truncated.lastIndexOf("\n");
  const safeTruncated = lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated;
  return safeTruncated + suffix;
}

export async function sendTodayWorkout(
  sender: WorkoutSender,
  client: Client,
  telegramId: number,
): Promise<boolean> {
  const workout = await getTodayWorkout(client, sender.language);

  if (!workout) {
    await sender.reply(t("workout.no_workout_today", sender.language));
    return false;
  }

  if (await isTodayWorkoutCompleted(client, workout)) {
    await sender.reply(t("workout.already_completed", sender.language));
    return false;
  }

  try {
    const { setState } = await import("../state/machine.js");
    await setState(telegramId, {
      action: "today",
      step: "viewing",
      data: {
        week_number: workout.week_number,
        day_name: workout.day_name,
        exercise_count: workout.exercises.length,
      },
    });
  } catch (stateErr) {
    console.warn(`[WORKOUT] setState failed for ${telegramId}:`, stateErr);
  }

  const message = await formatWorkoutMessage(workout, sender.language, client);
  const truncated = truncateMessage(message, t("program.truncation_suffix", sender.language));

  const buttons = [
    [{ text: t("workout.open_button", sender.language), callback_data: "today_open" }],
    [{ text: t("workout.skip_button", sender.language), callback_data: "skip_workout" }],
  ];

  await sender.reply(truncated, {
    reply_markup: {
      inline_keyboard: buttons,
    },
  });

  return true;
}
