import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { verifySession } from "@/lib/dal";
import { createClient } from "@/lib/supabase-server";
import { getParsedContent } from "@/lib/program-utils";
import { safeFetch, safeCount } from "@/lib/safe-fetch";
import type { Database } from "@/types/supabase";
import { ClientProfile } from "./_components/client-profile";
import { getClientActivity, loadMoreActivity } from "./actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("name")
    .eq("id", id)
    .maybeSingle<{ name: string }>();
  return {
    title: data?.name ?? "Клиент",
  };
}

export default async function ClientProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [session, { id }] = await Promise.all([
    verifySession(),
    params,
  ]);
  const { profile, supabase } = session;

  if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
    redirect("/dashboard");
  }

  const { data: client, error } = await supabase
    .from("clients")
    .select("id, name, telegram_id, status, payment_status, program_id, connect_code, spreadsheet_id, language, timezone, morning_time, measurement_time, measurement_day, access_start_date, access_end_date, created_at, updated_at, program:programs(id, title, active, template_file_url, parsed_content)")
    .eq("id", id)
    .single();

  if (error || !client) {
    notFound();
  }

  type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
  type ClientWithProgram = ClientRow & {
    program: Database["public"]["Tables"]["programs"]["Row"] | null;
  };
  const typedClient = client as unknown as ClientWithProgram;

  const [
    latestCheckinResult,
    workoutCountResult,
    checkinCountResult,
    messageCountResult,
    scheduleResult,
    checkinHistoryResult,
    measurementHistoryResult,
  ] = await Promise.all([
    safeFetch(
      supabase.from("checkins").select("date, wellbeing, sleep, stress, nutrition_adherence, missed_workouts, complaints").eq("client_id", id).order("date", { ascending: false }).limit(1).maybeSingle(),
      null,
    ),
    safeCount(
      supabase.from("workout_logs").select("*", { count: "exact", head: true }).eq("client_id", id),
    ),
    safeCount(
      supabase.from("checkins").select("*", { count: "exact", head: true }).eq("client_id", id),
    ),
    safeCount(
      supabase.from("messages").select("*", { count: "exact", head: true }).eq("client_id", id),
    ),
    safeFetch(
      supabase.from("program_schedule").select("id, week_number, focus, start_date, end_date").eq("client_id", id).order("week_number", { ascending: true }).limit(52),
      [],
    ),
    safeFetch(
      supabase.from("checkins").select("date, wellbeing, sleep, stress").eq("client_id", id).order("date", { ascending: false }).limit(20),
      [],
    ),
    safeFetch(
      supabase.from("measurements").select("date, weight, waist, chest, hips").eq("client_id", id).order("date", { ascending: false }).limit(20),
      [],
    ),
  ]);

  const parsedContent = typedClient.program ? getParsedContent(typedClient.program) : null;

  const measurementHistory = (measurementHistoryResult.data ?? []).reverse();
  const checkinHistory = (checkinHistoryResult.data ?? []).reverse();
  const latestMeasurement = measurementHistory.length > 0
    ? measurementHistory[measurementHistory.length - 1]
    : null;

  const { events: initialActivityEvents } = await getClientActivity(id);

  return (
    <div className="p-6">
      <ClientProfile
        client={typedClient}
        latestCheckin={latestCheckinResult.data}
        latestMeasurement={latestMeasurement}
        workoutCount={workoutCountResult.count}
        checkinCount={checkinCountResult.count}
        messageCount={messageCountResult.count}
        schedule={scheduleResult.data ?? []}
        parsedContent={parsedContent}
        checkinHistory={checkinHistory}
        measurementHistory={measurementHistory}
        initialActivityEvents={initialActivityEvents}
        loadMoreActivity={loadMoreActivity.bind(null, id)}
      />
    </div>
  );
}
