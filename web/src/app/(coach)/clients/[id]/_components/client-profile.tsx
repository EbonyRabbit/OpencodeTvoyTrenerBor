"use client";

import Link from "next/link";
// import Image from "next/image"; // DISABLED: photo storage removed
// import { useState } from "react"; // DISABLED: photo storage removed (was used for failedImages state)
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ActivityFeed } from "./activity-feed";
import { ClientActions } from "./client-actions";
import type { ActivityEvent } from "../activity-types";
import {
  CLIENT_STATUS_LABELS,
  CLIENT_STATUS_VARIANTS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_VARIANTS,
  LANGUAGE_LABELS,
  MEASUREMENT_DAY_OPTIONS,
  CHECKIN_DAY_OPTIONS,
} from "@/lib/clients";
import { getProgramStatus, STATUS_LABELS } from "@/lib/programs";
import { ProgramWeekPreview } from "@/app/(coach)/programs/[id]/_components/program-week-preview";
import { MiniLineChart } from "./mini-line-chart";
// import { PHOTO_TYPE_LABELS } from "@/lib/photos"; // DISABLED: photo storage removed
import { PauseSection } from "./pause-section";
import type { ParsedContent } from "@/lib/program-utils";
import type { NextWorkoutDay } from "@/lib/next-workout";
import { getTodayDateStr } from "@/lib/date-utils";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import type { Database, Json } from "@/types/supabase";

type ClientRow = Pick<Database["public"]["Tables"]["clients"]["Row"], "id" | "name" | "telegram_id" | "status" | "payment_status" | "program_id" | "connect_code" | "spreadsheet_id" | "language" | "timezone" | "morning_time" | "measurement_time" | "measurement_day" | "checkin_day" | "checkin_time" | "training_days" | "access_start_date" | "access_end_date" | "purchase_date" | "consent_given" | "consent_given_at" | "client_consent_given" | "client_consent_given_at" | "client_consent_version" | "created_at" | "updated_at"> & { program: { id: string; title: string; active: boolean; parsed_content: Json | null } | null };
type CheckinRow = Pick<Database["public"]["Tables"]["checkins"]["Row"], "date" | "wellbeing" | "sleep" | "stress" | "nutrition_adherence" | "missed_workouts" | "complaints">;
type MeasurementRow = Pick<Database["public"]["Tables"]["measurements"]["Row"], "date" | "weight" | "waist" | "chest" | "hips">;
type ScheduleRow = Pick<Database["public"]["Tables"]["program_schedule"]["Row"], "id" | "week_number" | "focus" | "start_date" | "end_date">;
type CheckinHistoryRow = Pick<Database["public"]["Tables"]["checkins"]["Row"], "date" | "wellbeing" | "sleep" | "stress">;
type MeasurementHistoryRow = Pick<Database["public"]["Tables"]["measurements"]["Row"], "date" | "weight" | "waist" | "chest" | "hips">;
type PurchaseRequestRow = Pick<
  Database["public"]["Tables"]["purchase_requests"]["Row"],
  "id" | "sub_type" | "status" | "amount" | "created_at" | "paid_at"
> & { program: { id: string; title: string } | null };
// type PhotoRow = Pick<Database["public"]["Tables"]["photos"]["Row"], "id" | "date" | "type" | "drive_url"> & { resolvedUrl: string | null }; // DISABLED: photo storage removed

const MEASUREMENT_DAY_LABELS: Record<number, string> = Object.fromEntries(
  MEASUREMENT_DAY_OPTIONS.map((o) => [o.value, o.label])
) as Record<number, string>;

const WEEKDAY_LABELS: Record<number, string> = Object.fromEntries(
  CHECKIN_DAY_OPTIONS.map((o) => [o.value, o.label])
) as Record<number, string>;

const PURCHASE_REQUEST_STATUS_LABELS: Record<string, string> = {
  pending: "Ожидает оплаты",
  paid: "Оплачено",
  cancelled: "Отменена",
};

const PURCHASE_REQUEST_STATUS_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "secondary",
  paid: "default",
  cancelled: "destructive",
};

const PURCHASE_SUB_TYPE_LABELS: Record<string, string> = {
  program: "Программа",
  individ: "Индивидуальное ведение",
};

function formatDate(date: string | null): string {
  if (!date) return "—";
  try {
    return new Date(date).toLocaleDateString("ru-RU");
  } catch {
    return "—";
  }
}

function formatTime(time: string | null): string {
  if (!time) return "—";
  const parts = time.split(":");
  const h = parts[0];
  const m = parts[1];
  if (!h || isNaN(Number(h)) || (m !== undefined && isNaN(Number(m)))) return "—";
  return `${h.padStart(2, "0")}:${(m ?? "00").padStart(2, "0")}`;
}

function formatNextWorkout(next: NextWorkoutDay, tz: string | null): string {
  if (next.isToday) return "Сегодня";
  const todayLocal = getTodayDateStr(tz || DEFAULT_TIMEZONE);
  const diffDays = Math.round(
    (new Date(`${next.date}T12:00:00Z`).getTime() -
      new Date(`${todayLocal}T12:00:00Z`).getTime()) /
      (1000 * 60 * 60 * 24),
  );
  if (diffDays === 1) return "Завтра";
  return new Date(`${next.date}T12:00:00Z`).toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function daysSince(date: string | null): number | null {
  if (!date) return null;
  try {
    const start = new Date(date);
    if (isNaN(start.getTime())) return null;
    const now = new Date();
    return Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

function formatAmount(amount: number | null): string {
  if (amount == null) return "—";
  return `${amount.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">{children}</CardContent>
    </Card>
  );
}

function AccessBadge({
  accessStart,
  accessEnd,
}: {
  accessStart: string | null;
  accessEnd: string | null;
}) {
  const now = new Date();
  const end = accessEnd ? new Date(accessEnd) : null;
  const isExpired = end && end < now;

  if (isExpired) {
    return <Badge variant="destructive">Доступ истёк</Badge>;
  }

  if (accessStart && end) {
    return <Badge variant="default">Активен</Badge>;
  }

  if (accessStart && !end) {
    return <Badge variant="default">Бессрочно</Badge>;
  }

  return <Badge variant="secondary">Не указан</Badge>;
}

function CheckinScore({ label, value }: { label: string; value: number | null }) {
  const isStress = label === "Стресс";
  const color =
    value === null
      ? "text-muted-foreground"
      : isStress
        ? value <= 3
          ? "text-green-600"
          : value <= 6
            ? "text-yellow-600"
            : "text-red-600"
        : value >= 7
          ? "text-green-600"
          : value >= 4
            ? "text-yellow-600"
            : "text-red-600";

  return (
    <div className="flex items-center justify-between py-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium ${color}`}>
        {value !== null ? `${value}/10` : "—"}
      </span>
    </div>
  );
}

export function ClientProfile({
  client,
  latestCheckin,
  latestMeasurement,
  workoutCount,
  checkinCount,
  messageCount,
  schedule,
  parsedContent,
  nextWorkout,
  checkinHistory,
  measurementHistory,
  initialActivityEvents,
  loadMoreActivity,
  // latestPhotos, // DISABLED: photo storage removed
  purchasedProgramName,
  purchaseRequests,
}: {
  client: ClientRow;
  latestCheckin: CheckinRow | null;
  latestMeasurement: MeasurementRow | null;
  workoutCount: number | null;
  checkinCount: number;
  messageCount: number;
  schedule: ScheduleRow[];
  parsedContent: ParsedContent | null;
  nextWorkout: NextWorkoutDay | null;
  checkinHistory: CheckinHistoryRow[];
  measurementHistory: MeasurementHistoryRow[];
  initialActivityEvents: ActivityEvent[];
  loadMoreActivity: (offset: number) => Promise<ActivityEvent[] | { error: string }>;
  // latestPhotos: PhotoRow[]; // DISABLED: photo storage removed
  purchasedProgramName: string | null;
  purchaseRequests: PurchaseRequestRow[];
}) {
  const accessDays = daysSince(client.access_start_date);
  const programStatus = client.program ? getProgramStatus(client.program) : null;
  // const [failedImages, setFailedImages] = useState<Set<string>>(new Set()); // DISABLED: photo storage removed

  const programDayOrders = useMemo(() => {
    const firstWeek = parsedContent?.weeks?.[0];
    if (!firstWeek?.days) return [];
    return firstWeek.days
      .filter((d) => (d.exercises?.length ?? 0) > 0)
      .map((d) => d.day_order)
      .sort((a, b) => a - b);
  }, [parsedContent]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href="/clients"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← Назад к клиентам
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="break-words min-w-0">
          <h1 className="text-2xl font-bold">{client.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Клиент с {formatDate(client.created_at)}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Badge variant={CLIENT_STATUS_VARIANTS[client.status] ?? "secondary"}>
            {CLIENT_STATUS_LABELS[client.status] ?? client.status}
          </Badge>
          <Badge
            variant={PAYMENT_STATUS_VARIANTS[client.payment_status] ?? "secondary"}
          >
            {PAYMENT_STATUS_LABELS[client.payment_status] ?? client.payment_status}
          </Badge>
        </div>
      </div>

      {client.status === "access_expired" && (
        <Alert role="alert" variant="destructive">
          <AlertTitle>Доступ клиента истёк</AlertTitle>
          <AlertDescription>
            Срок доступа закончился {formatDate(client.access_end_date)}.
            Продлите доступ, чтобы клиент мог пользоваться программой.
          </AlertDescription>
        </Alert>
      )}

      {client.payment_status === "pending" && (
        <Alert role="alert" variant="destructive">
          <AlertTitle>Оплата не получена</AlertTitle>
          <AlertDescription>
            Статус оплаты — «Ожидает». Напомните клиенту об оплате.
          </AlertDescription>
        </Alert>
      )}

      {!client.program && (
        <Alert role="alert" variant="default">
          <AlertTitle>Программа не назначена</AlertTitle>
          <AlertDescription>
            У клиента нет активной программы. Назначьте программу из каталога.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <SectionCard title="Информация">
          <InfoRow label="Telegram ID" value={client.telegram_id ? String(client.telegram_id) : "—"} />
          <InfoRow label="Язык" value={LANGUAGE_LABELS[client.language] ?? client.language} />
          <InfoRow label="Часовой пояс" value={client.timezone ?? "—"} />
          <InfoRow label="Утро (напоминание)" value={formatTime(client.morning_time)} />
          <InfoRow label="Замеры — день" value={client.measurement_day != null ? (MEASUREMENT_DAY_LABELS[client.measurement_day] ?? String(client.measurement_day)) : "—"} />
          <InfoRow label="Замеры — время" value={formatTime(client.measurement_time)} />
          <InfoRow label="Чек-ин — день" value={client.checkin_day != null ? WEEKDAY_LABELS[client.checkin_day] ?? String(client.checkin_day) : "—"} />
          <InfoRow label="Чек-ин — время" value={formatTime(client.checkin_time)} />
          <InfoRow label="Код подключения" value={client.connect_code ?? "—"} />
          <InfoRow label="ID в Google Sheets" value={client.spreadsheet_id ?? "—"} />
        </SectionCard>

        <SectionCard title="Доступ и программа">
          <InfoRow label="Начало доступа" value={formatDate(client.access_start_date)} />
          <div className="flex justify-between py-1.5 text-sm">
            <span className="text-muted-foreground">Окончание доступа</span>
            <div className="flex items-center gap-2">
              <span>{formatDate(client.access_end_date)}</span>
              <AccessBadge
                accessStart={client.access_start_date}
                accessEnd={client.access_end_date}
              />
            </div>
          </div>
          <InfoRow
            label="Дней с начала"
            value={accessDays !== null ? `${accessDays} дн.` : "—"}
          />
          <div className="flex justify-between py-1.5 text-sm">
            <span className="text-muted-foreground">Программа</span>
            <span>
              {client.program ? (
                <Link
                  href={`/programs/${client.program.id}`}
                  className="underline-offset-4 hover:underline"
                >
                  {client.program.title}
                </Link>
              ) : (
                "—"
              )}
            </span>
          </div>
          {client.program && programStatus && (
            <InfoRow
              label="Статус программы"
              value={STATUS_LABELS[programStatus]}
            />
          )}
          {nextWorkout ? (
            <InfoRow
              label="Следующая тренировка"
              value={
                <span
                  className={
                    nextWorkout.isToday
                      ? "font-semibold text-green-600"
                      : undefined
                  }
                >
                  {formatNextWorkout(nextWorkout, client.timezone)}
                </span>
              }
            />
          ) : null}
          {client.purchase_date && (
            <InfoRow
              label="Дата покупки"
              value={formatDate(client.purchase_date)}
            />
          )}
          {purchasedProgramName && (
            <InfoRow
              label="Купленная программа"
              value={purchasedProgramName}
            />
          )}
        </SectionCard>
      </div>

      <SectionCard title="Согласие на обработку ПДн">
        <div className="flex justify-between py-1.5 text-sm">
          <span className="text-muted-foreground">Клиент дал согласие</span>
          <span>
            {client.client_consent_given ? (
              <span className="text-green-600 font-medium">Да</span>
            ) : (
              <span className="text-muted-foreground">Нет</span>
            )}
          </span>
        </div>
        {client.client_consent_given_at && (
          <InfoRow
            label="Дата согласия"
            value={new Date(client.client_consent_given_at).toLocaleString("ru-RU")}
          />
        )}
        {client.client_consent_version && (
          <InfoRow
            label="Версия политики"
            value={client.client_consent_version}
          />
        )}
        {client.consent_given && (
          <InfoRow
            label="Отметка тренера"
            value="Подтверждено"
          />
        )}
      </SectionCard>

      <SectionCard title="Оплаты">
        {purchaseRequests.length > 0 ? (
          <div className="space-y-2">
            {purchaseRequests.map((req) => (
              <div
                key={req.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {PURCHASE_SUB_TYPE_LABELS[req.sub_type] ?? req.sub_type}
                    </Badge>
                    <Badge
                      variant={
                        PURCHASE_REQUEST_STATUS_VARIANTS[req.status] ?? "secondary"
                      }
                      className="text-[10px]"
                    >
                      {PURCHASE_REQUEST_STATUS_LABELS[req.status] ?? req.status}
                    </Badge>
                  </div>
                  <p className="truncate font-medium">
                    {req.program ? (
                      <Link
                        href={`/programs/${req.program.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {req.program.title}
                      </Link>
                    ) : req.sub_type === "individ" ? (
                      PURCHASE_SUB_TYPE_LABELS.individ
                    ) : (
                      "Программа удалена"
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Заявка от {formatDate(req.created_at)}
                    {req.status === "paid" && req.paid_at
                      ? ` · оплачено ${formatDate(req.paid_at)}`
                      : ""}
                  </p>
                </div>
                <span className="shrink-0 font-medium">{formatAmount(req.amount)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Нет заявок на покупку</p>
        )}
      </SectionCard>

      <div className="grid gap-6 sm:grid-cols-3">
        <SectionCard title="Статистика">
          <InfoRow
            label="Тренировок"
            value={workoutCount == null ? "—" : String(workoutCount)}
          />
          <InfoRow label="Чек-инов" value={String(checkinCount)} />
          <InfoRow label="Сообщений" value={String(messageCount)} />
          <InfoRow label="Недель в расписании" value={String(schedule.length)} />
        </SectionCard>

        <SectionCard title="Последний чек-ин">
          {latestCheckin ? (
            <>
              <InfoRow label="Дата" value={formatDate(latestCheckin.date)} />
              <CheckinScore label="Самочувствие" value={latestCheckin.wellbeing} />
              <CheckinScore label="Сон" value={latestCheckin.sleep} />
              <CheckinScore label="Стресс" value={latestCheckin.stress} />
              <InfoRow
                label="Питание"
                value={
                  latestCheckin.nutrition_adherence != null
                    ? `${latestCheckin.nutrition_adherence}%`
                    : "—"
                }
              />
              <InfoRow
                label="Пропуски"
                value={
                  latestCheckin.missed_workouts != null
                    ? String(latestCheckin.missed_workouts)
                    : "—"
                }
              />
              {latestCheckin.complaints && (
                <div className="pt-2">
                  <p className="text-xs text-muted-foreground">Жалобы</p>
                  <p className="mt-0.5 text-sm">{latestCheckin.complaints}</p>
                </div>
              )}
              <div className="pt-3">
                <Link
                  href={`/clients/${client.id}/checkins`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Все чек-ины →
                </Link>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Нет чек-инов
            </p>
          )}
        </SectionCard>

        <SectionCard title="Последние замеры">
          {latestMeasurement ? (
            <>
              <InfoRow label="Дата" value={formatDate(latestMeasurement.date)} />
              {latestMeasurement.weight != null && (
                <InfoRow label="Вес" value={`${latestMeasurement.weight} кг`} />
              )}
              {latestMeasurement.waist != null && (
                <InfoRow label="Талия" value={`${latestMeasurement.waist} см`} />
              )}
              {latestMeasurement.chest != null && (
                <InfoRow label="Грудь" value={`${latestMeasurement.chest} см`} />
              )}
              {latestMeasurement.hips != null && (
                <InfoRow label="Бёдра" value={`${latestMeasurement.hips} см`} />
              )}
              <div className="pt-3">
                <Link
                  href={`/clients/${client.id}/measurements`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Все замеры →
                </Link>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Нет замеров
            </p>
          )}
        </SectionCard>
      </div>

      {/* DISABLED: photo storage removed — clients save photos on their own devices
      <SectionCard title="Последние фото">
        {latestPhotos.length > 0 ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              {latestPhotos.slice(0, 6).map((photo) => (
                <Link
                  key={photo.id}
                  href={`/clients/${client.id}/photos`}
                  className="group relative aspect-[3/4] w-full overflow-hidden rounded-md border bg-muted"
                  aria-label={`${PHOTO_TYPE_LABELS[photo.type] ?? "Фото"}`}
                >
                  {photo.resolvedUrl && !failedImages.has(photo.id) ? (
                    <Image
                      src={photo.resolvedUrl}
                      alt={PHOTO_TYPE_LABELS[photo.type] ?? "Фото"}
                      fill
                      className="object-cover transition-transform group-hover:scale-105"
                      sizes="(max-width: 640px) 33vw, 15vw"
                      onError={() => setFailedImages((prev) => new Set(prev).add(photo.id))}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <span className="text-xs text-muted-foreground">—</span>
                    </div>
                  )}
                  <Badge
                    className="absolute left-1 top-1 text-[10px]"
                    variant="secondary"
                  >
                    {PHOTO_TYPE_LABELS[photo.type] ?? photo.type}
                  </Badge>
                </Link>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Нет прогресс-фото
          </p>
        )}
        <div className="pt-3">
          <Link
            href={`/clients/${client.id}/photos`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Все фото →
          </Link>
        </div>
      </SectionCard>
      */}

      <SectionCard title="Дисциплина">
        <p className="text-sm text-muted-foreground">
          Процент выполненных тренировок относительно плана программы.
        </p>
        <div className="pt-3">
          <Link
            href={`/clients/${client.id}/workouts`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Дисциплина →
          </Link>
        </div>
      </SectionCard>

      <PauseSection clientId={client.id} />

      {(checkinHistory.length > 0 || measurementHistory.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Прогресс
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {measurementHistory.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-medium">Вес</h3>
                <MiniLineChart
                  data={measurementHistory.map((m) => ({
                    label: m.date,
                    value: m.weight,
                  }))}
                  color="var(--color-primary, #2563eb)"
                />
              </div>
            )}
            {checkinHistory.some((c) => c.wellbeing !== null) && (
              <div>
                <h3 className="mb-2 text-sm font-medium">Самочувствие</h3>
                <MiniLineChart
                  data={checkinHistory.map((c) => ({
                    label: c.date,
                    value: c.wellbeing,
                  }))}
                  color="var(--color-chart-2, #16a34a)"
                />
              </div>
            )}
            {checkinHistory.some((c) => c.stress !== null) && (
              <div>
                <h3 className="mb-2 text-sm font-medium">Стресс</h3>
                <MiniLineChart
                  data={checkinHistory.map((c) => ({
                    label: c.date,
                    value: c.stress,
                  }))}
                  color="var(--color-chart-3, #dc2626)"
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {schedule.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Расписание программы
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {schedule.map((week) => (
                <div
                  key={week.id}
                  className="rounded-lg border p-3 text-sm"
                >
                  <p className="font-medium">Неделя {week.week_number}</p>
                  {week.focus && (
                    <p className="mt-1 text-muted-foreground">
                      {week.focus}
                    </p>
                  )}
                  {week.start_date && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDate(week.start_date)}
                      {week.end_date ? ` — ${formatDate(week.end_date)}` : ""}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {client.program && (
        <div className="rounded-lg border p-4">
          <ProgramWeekPreview parsed={parsedContent} />
        </div>
      )}

      <ActivityFeed
        initialEvents={initialActivityEvents}
        loadMore={loadMoreActivity}
      />

      <Separator />

      <ClientActions
        clientId={client.id}
        currentCode={client.connect_code}
        currentStatus={client.status}
        currentProgramId={client.program_id}
        currentPaymentStatus={client.payment_status}
        clientName={client.name}
        clientLanguage={client.language}
        clientTimezone={client.timezone}
        clientMorningTime={client.morning_time}
        clientMeasurementTime={client.measurement_time}
        clientMeasurementDay={client.measurement_day}
        clientCheckinDay={client.checkin_day}
        clientCheckinTime={client.checkin_time}
        clientTrainingDays={client.training_days}
        programDayOrders={programDayOrders}
        clientTelegramId={client.telegram_id}
      />

      <div className="flex justify-end gap-2">
        <Link
          href={`/clients/${client.id}/chat`}
          className={buttonVariants({ variant: "outline" })}
        >
          Чат
        </Link>
        {client.telegram_id ? (
          <a
            href={`tg://user?id=${client.telegram_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline" })}
          >
            Написать в Telegram
          </a>
        ) : (
          <span
            className={buttonVariants({ variant: "outline" }) + " pointer-events-none opacity-50"}
            aria-disabled="true"
            title="Клиент не подключён к боту"
          >
            Нет Telegram
          </span>
        )}
      </div>
    </div>
  );
}
