import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getParsedContent } from "@/lib/program-utils";
import { calculateAdherence, getAdherenceColor } from "@/lib/adherence";
import { getNextWorkoutDay, hasTrainedOnDate } from "@/lib/next-workout";
import { safeFetch } from "@/lib/safe-fetch";
import { getTodayDateStr } from "@/lib/date-utils";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Database } from "@/types/supabase";

type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
type ScheduleRow = Database["public"]["Tables"]["program_schedule"]["Row"];

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Доброе утро";
  if (hour < 18) return "Добрый день";
  return "Добрый вечер";
}

function formatWorkoutDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export default async function ClientHomePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const h = await headers();
  const clientId = h.get("x-client-id");
  if (!clientId) notFound();

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle<ClientRow>();
  if (!client) notFound();

  const today = getTodayDateStr(client.timezone || DEFAULT_TIMEZONE);

  const [programResult, scheduleResult, workoutResult, checkinResult] = await Promise.all([
    client.program_id
      ? safeFetch(
          supabaseAdmin
            .from("programs")
            .select("*")
            .eq("id", client.program_id)
            .maybeSingle(),
          null,
        )
      : Promise.resolve({ data: null }),
    client.program_id
      ? safeFetch(
          supabaseAdmin
            .from("program_schedule")
            .select("week_number, start_date, end_date, focus, is_deload, status, training_days")
            .eq("client_id", clientId)
            .order("week_number"),
          [] as ScheduleRow[],
        )
      : Promise.resolve({ data: [] as ScheduleRow[] }),
    safeFetch(
      supabaseAdmin
        .from("workout_logs")
        .select("date, exercise, week, day_order")
        .eq("client_id", clientId),
      [] as { date: string; exercise?: string | null; week?: number | null; day_order?: number | null }[],
    ),
    safeFetch(
      supabaseAdmin
        .from("checkins")
        .select("created_at, wellbeing, sleep, stress")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ created_at: string; wellbeing: number | null; sleep: number | null; stress: number | null }>(),
      null,
    ),
  ]);

  const program = programResult.data as Parameters<typeof getParsedContent>[0] | null;
  const schedule = scheduleResult.data ?? [];
  const workoutLogs = (workoutResult.data ?? []) as Parameters<typeof calculateAdherence>[2];
  const latestCheckin = checkinResult.data as { created_at: string; wellbeing: number | null; sleep: number | null; stress: number | null } | null;

  const parsed = program ? getParsedContent(program) : null;

  const currentWeek = schedule.find(
    (w) => w.start_date && w.end_date && w.start_date <= today && w.end_date >= today,
  );

  const adherence = schedule.length > 0 && parsed
    ? calculateAdherence(schedule, parsed, workoutLogs, client.training_days, today)
    : null;

  const currentWeekStats = currentWeek && parsed
    ? (() => {
        const week = adherence?.weeks.find(
          (w) => w.weekNumber === currentWeek.week_number,
        );
        if (!week) return null;
        return {
          completed: week.completed,
          expected: week.expected,
          adherencePct: week.adherencePct,
        };
      })()
    : null;

  const nextWorkout = getNextWorkoutDay({
    schedule,
    clientTrainingDays: client.training_days,
    parsed,
    workoutLogs,
    today,
  });

  const trainedToday = hasTrainedOnDate(workoutLogs, today);

  const quickLinks = [
    { href: `/client/${token}/program`, label: "Программа", desc: "Просмотр тренировок" },
    { href: `/client/${token}/measurements`, label: "Замеры", desc: "Прогресс тела" },
    { href: `/client/${token}/photos`, label: "Фото", desc: "Фото прогресса" },
    { href: `/client/${token}/checkin`, label: "Чек-ин", desc: "Еженедельный опрос" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">
          {getGreeting()}, {client.name}!
        </h2>
        {program && (
          <p className="text-sm text-muted-foreground">
            Программа: {program.title}
          </p>
        )}
      </div>

      {(nextWorkout || trainedToday) && (
        <Link href={`/client/${token}/program`} className="block">
          <Card className="transition-colors hover:bg-muted">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Следующая тренировка
                  </p>
                  <p className="mt-1 text-lg font-semibold">
                    {trainedToday ? (
                      <span className="text-green-600">✅ Выполнена сегодня</span>
                    ) : nextWorkout?.isToday ? (
                      <span className="text-green-600">Сегодня</span>
                    ) : nextWorkout ? (
                      formatWorkoutDate(nextWorkout.date)
                    ) : null}
                  </p>
                  {trainedToday && nextWorkout && !nextWorkout.isToday && (
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Следующая: {formatWorkoutDate(nextWorkout.date)}
                    </p>
                  )}
                  {trainedToday && nextWorkout?.isToday && (
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Завершите сегодняшнюю тренировку
                    </p>
                  )}
                </div>
                <span className="text-sm text-muted-foreground">→</span>
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {currentWeek ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Текущая неделя
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold">
                Неделя {currentWeek.week_number}
              </span>
              {currentWeek.is_deload && (
                <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">
                  Разгрузка
                </span>
              )}
            </div>
            {currentWeek.focus && (
              <p className="text-sm text-muted-foreground">{currentWeek.focus}</p>
            )}
            {currentWeek.start_date && currentWeek.end_date && (
              <p className="text-xs text-muted-foreground">
                {new Date(currentWeek.start_date).toLocaleDateString("ru-RU")} —{" "}
                {new Date(currentWeek.end_date).toLocaleDateString("ru-RU")}
              </p>
            )}
            {currentWeekStats && (
              <p className="text-sm">
                Тренировки: {currentWeekStats.completed} (плановых:{" "}
                {currentWeekStats.expected}){" "}
                <span className={getAdherenceColor(currentWeekStats.adherencePct)}>
                  ({currentWeekStats.adherencePct}%)
                </span>
              </p>
            )}
          </CardContent>
        </Card>
      ) : program ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Программа ещё не начата
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Тренер скоро назначит вам программу
          </CardContent>
        </Card>
      )}

      {adherence && adherence.overallAdherence !== null && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Общая посещаемость
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              <span className={getAdherenceColor(adherence.overallAdherence)}>
                {adherence.overallAdherence}%
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {adherence.totalCompleted} тренировок (плановых:{" "}
              {adherence.totalExpected})
            </p>
          </CardContent>
        </Card>
      )}

      {latestCheckin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Последний чек-ин
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 text-sm">
              {latestCheckin.wellbeing != null && (
                <span>Самочувствие: {latestCheckin.wellbeing}/10</span>
              )}
              {latestCheckin.sleep != null && (
                <span>Сон: {latestCheckin.sleep}ч</span>
              )}
              {latestCheckin.stress != null && (
                <span>Стресс: {latestCheckin.stress}/10</span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {new Date(latestCheckin.created_at).toLocaleDateString("ru-RU")}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {quickLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="block rounded-lg border p-4 text-sm font-medium transition-colors hover:bg-muted"
          >
            {link.label}
            <span className="ml-2 text-xs text-muted-foreground">{link.desc}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
