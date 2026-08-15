import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getParsedContent, flattenLoggableExercises, type ParsedDay } from "@/lib/program-utils";
import type { ExerciseLibraryRow } from "@/lib/exercise-library";
import type { ClientRow } from "@/lib/clients";
import { getTodayDateStr } from "@/lib/date-utils";
import { WorkoutForm } from "./workout-form";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarOff, CheckCircle2 } from "lucide-react";

const DEFAULT_TIMEZONE = "Europe/Moscow";

function getTodayDayName(tz: string): string {
  return new Intl.DateTimeFormat("ru-RU", { weekday: "long", timeZone: tz })
    .format(new Date())
    .toLowerCase();
}

function getTodayISODay(tz: string): number {
  const dayName = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: tz,
  })
    .format(new Date())
    .toLowerCase();
  const dayMap: Record<string, number> = {
    monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
    friday: 5, saturday: 6, sunday: 7,
  };
  return dayMap[dayName] ?? 0;
}

function daysBetween(dateStrA: string, dateStrB: string): number {
  const a = new Date(dateStrA + "T00:00:00Z");
  const b = new Date(dateStrB + "T00:00:00Z");
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function matchDay(
  days: ParsedDay[],
  todayName: string,
  todayISODay: number,
  trainingDays: number[] | null,
  startDate: string | null,
  todayStr: string,
): ParsedDay | undefined {
  if (trainingDays && trainingDays.length > 0) {
    const dayIndex = trainingDays.indexOf(todayISODay);
    if (dayIndex === -1) return undefined;
    return days.find((d) => d.day_order === dayIndex + 1);
  }
  return days.find((d) => {
    const normalizedName = d.day_name.toLowerCase();
    if (normalizedName.includes(todayName)) return true;
    if (startDate) {
      const dayOffset = daysBetween(startDate, todayStr);
      return d.day_order === dayOffset + 1;
    }
    return false;
  });
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function todayLabelFor(iso: number): string {
  const base = new Date(Date.UTC(2026, 0, 5 + (iso - 1)));
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    timeZone: "UTC",
  }).format(base);
}

export default async function WorkoutPage() {
  const h = await headers();
  const clientId = h.get("x-client-id");
  if (!clientId) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Тренировка недоступна</p>
        </CardContent>
      </Card>
    );
  }

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("program_id, timezone, training_days, language")
    .eq("id", clientId)
    .maybeSingle<Pick<ClientRow, "program_id" | "timezone" | "training_days"> & { language: string | null }>();

  if (!client?.program_id) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Программа не назначена</p>
        </CardContent>
      </Card>
    );
  }

  const tz = client.timezone || DEFAULT_TIMEZONE;
  const todayStr = getTodayDateStr(tz);
  const todayName = getTodayDayName(tz);
  const todayISODay = getTodayISODay(tz);

  const { data: schedule } = await supabaseAdmin
    .from("program_schedule")
    .select("week_number, start_date, end_date, training_days")
    .eq("client_id", clientId);

  const currentWeek = (schedule ?? []).find((w) => {
    if (!w.start_date || !w.end_date) return false;
    return todayStr >= w.start_date && todayStr <= w.end_date;
  });

  const weekTrainingDays = currentWeek?.training_days ?? client.training_days;

  if (!currentWeek) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <CalendarOff className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-lg font-semibold">Нет активной недели</p>
          <p className="text-sm text-muted-foreground">
            Тренировочная программа ещё не началась или уже завершена
          </p>
        </CardContent>
      </Card>
    );
  }

  const { data: program } = await supabaseAdmin
    .from("programs")
    .select("*")
    .eq("id", client.program_id)
    .maybeSingle();

  if (!program) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Программа не найдена</p>
        </CardContent>
      </Card>
    );
  }

  const parsed = getParsedContent(program);
  if (!parsed) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Данные программы повреждены</p>
        </CardContent>
      </Card>
    );
  }

  const weekData = parsed.weeks?.find((w) => w.week_number === currentWeek.week_number);
  if (!weekData?.days) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Нет данных по неделе</p>
        </CardContent>
      </Card>
    );
  }

  const matchedDay = matchDay(
    weekData.days,
    todayName,
    todayISODay,
    weekTrainingDays,
    currentWeek.start_date,
    todayStr,
  );

  if (!matchedDay?.exercises?.length) {
    const dayNames = weekTrainingDays?.length
      ? weekTrainingDays.map((iso) => capitalize(todayLabelFor(iso))).join(", ")
      : weekData.days.map((d) => d.day_name).join(", ");
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <CalendarOff className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-lg font-semibold">Сегодня отдых</p>
          <p className="text-sm text-muted-foreground">
            Тренировки на этой неделе: {dayNames}
          </p>
        </CardContent>
      </Card>
    );
  }

  const dayTitle = weekTrainingDays?.length
    ? capitalize(todayName)
    : matchedDay.day_name;

  const { data: logs, error: logsError } = await supabaseAdmin
    .from("workout_logs")
    .select("exercise")
    .eq("client_id", clientId)
    .eq("date", todayStr);
  if (logsError) {
    console.error(`[WORKOUT] Logs query failed for ${clientId}:`, logsError.message);
  }

  const loggedNames = new Set(
    (logs ?? [])
      .map((l) => l.exercise?.trim().toLowerCase())
      .filter((name): name is string => Boolean(name) && !name.startsWith("[")),
  );
  const targets = flattenLoggableExercises(matchedDay.exercises);
  const workoutCompleted =
    targets.length > 0 &&
    targets.every((ex) => loggedNames.has(ex.name.trim().toLowerCase()));

  const { data: libraryRows } = await supabaseAdmin
    .from("exercises")
    .select("id, name, name_key, aliases, description_ru, description_en, technique_ru, technique_en, features_ru, features_en, video_url")
    .order("name", { ascending: true })
    .limit(1000);

  const library = (libraryRows ?? []) as ExerciseLibraryRow[];
  const portalLanguage: "ru" | "en" = client.language === "en" ? "en" : "ru";

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{dayTitle}</h2>
        <p className="text-sm text-muted-foreground">
          Неделя {currentWeek.week_number}
          {weekData.is_deload && " (разгрузочная)"}
        </p>
      </div>
      {workoutCompleted ? (
        <Card>
          <CardContent className="py-8 text-center">
            <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-600" />
            <p className="text-lg font-semibold">Тренировка завершена</p>
            <p className="text-sm text-muted-foreground">
              Все упражнения записаны. Отличная работа!
            </p>
          </CardContent>
        </Card>
      ) : (
        <WorkoutForm
          exercises={matchedDay.exercises}
          date={todayStr}
          week={currentWeek.week_number}
          dayOrder={matchedDay.day_order ?? null}
          library={library}
          language={portalLanguage}
        />
      )}
    </div>
  );
}
