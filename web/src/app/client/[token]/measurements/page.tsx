import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { safeFetch } from "@/lib/safe-fetch";
import type { ClientRow } from "@/lib/clients";
import type { Database } from "@/types/supabase";
import { MeasurementsForm } from "./measurements-form";
import { MeasurementHistory } from "./measurement-history";
import { MeasurementTrends } from "@/app/(coach)/clients/[id]/measurements/_components/measurement-trends";

const DEFAULT_TIMEZONE = "Europe/Moscow";
const HISTORY_LIMIT = 10;

type MeasurementRow = Database["public"]["Tables"]["measurements"]["Row"];

function getTodayDateStr(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

export default async function MeasurementsPage() {
  const h = await headers();
  const clientId = h.get("x-client-id");
  if (!clientId) notFound();

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, timezone")
    .eq("id", clientId)
    .maybeSingle<Pick<ClientRow, "id" | "timezone">>();

  if (!client) notFound();

  const tz = client.timezone || DEFAULT_TIMEZONE;
  const date = getTodayDateStr(tz);

  const [
    { data: todayMeasurement },
    { data: historyData },
    { data: chartData },
  ] = await Promise.all([
    safeFetch(
      supabaseAdmin
        .from("measurements")
        .select("*")
        .eq("client_id", clientId)
        .eq("date", date)
        .maybeSingle<MeasurementRow>(),
      null,
    ),
    safeFetch(
      supabaseAdmin
        .from("measurements")
        .select("*")
        .eq("client_id", clientId)
        .order("date", { ascending: false })
        .limit(HISTORY_LIMIT),
      [] as MeasurementRow[],
    ),
    safeFetch(
      supabaseAdmin
        .from("measurements")
        .select("date, weight, waist, abdomen, chest, hips, glutes, left_thigh, right_thigh, left_arm, right_arm, body_fat, muscle_mass, visceral_fat")
        .eq("client_id", clientId)
        .order("date", { ascending: false })
        .limit(20),
      [] as Pick<MeasurementRow, "date" | "weight" | "waist" | "abdomen" | "chest" | "hips" | "glutes" | "left_thigh" | "right_thigh" | "left_arm" | "right_arm" | "body_fat" | "muscle_mass" | "visceral_fat">[],
    ),
  ]);

  const history = historyData ?? [];
  const chartHistory = [...(chartData ?? [])].reverse();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Замеры тела</h2>
        <p className="text-sm text-muted-foreground">
          Запишите текущие параметры тела
        </p>
      </div>
      <MeasurementsForm date={date} existing={todayMeasurement} />
      <MeasurementTrends data={chartHistory} />
      <MeasurementHistory measurements={history} />
    </div>
  );
}
