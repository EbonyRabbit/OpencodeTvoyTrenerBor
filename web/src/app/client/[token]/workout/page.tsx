import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getParsedContent, type ParsedDay } from "@/lib/program-utils";
import type { ClientRow } from "@/lib/clients";
import { WorkoutForm } from "./workout-form";

const DEFAULT_TIMEZONE = "Europe/Moscow";

function getTodayDateStr(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

function getTodayDayName(tz: string): string {
  return new Intl.DateTimeFormat("ru-RU", { weekday: "long", timeZone: tz })
    .format(new Date())
    .toLowerCase();
}

export default async function WorkoutPage() {
  const h = await headers();
  const clientId = h.get("x-client-id");
  if (!clientId) notFound();

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("program_id, timezone")
    .eq("id", clientId)
    .maybeSingle<Pick<ClientRow, "program_id" | "timezone">>();

  if (!client?.program_id) notFound();

  const tz = client.timezone || DEFAULT_TIMEZONE;
  const todayStr = getTodayDateStr(tz);
  const todayName = getTodayDayName(tz);

  const { data: schedule } = await supabaseAdmin
    .from("program_schedule")
    .select("week_number, start_date, end_date")
    .eq("client_id", clientId);

  const currentWeek = (schedule ?? []).find((w) => {
    if (!w.start_date || !w.end_date) return false;
    return todayStr >= w.start_date && todayStr <= w.end_date;
  });

  if (!currentWeek) notFound();

  const { data: program } = await supabaseAdmin
    .from("programs")
    .select("*")
    .eq("id", client.program_id)
    .maybeSingle();

  if (!program) notFound();

  const parsed = getParsedContent(program);
  if (!parsed) notFound();

  const weekData = parsed.weeks?.find((w) => w.week_number === currentWeek.week_number);
  if (!weekData?.days) notFound();

  const matchedDay: ParsedDay | undefined = weekData.days.find((d) =>
    d.day_name.toLowerCase().includes(todayName),
  );

  if (!matchedDay?.exercises?.length) notFound();

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{matchedDay.day_name}</h2>
        <p className="text-sm text-muted-foreground">
          Неделя {currentWeek.week_number}
          {weekData.is_deload && " (разгрузочная)"}
        </p>
      </div>
      <WorkoutForm
        exercises={matchedDay.exercises}
        date={todayStr}
        week={currentWeek.week_number}
      />
    </div>
  );
}
