import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { verifySession } from "@/lib/dal";
import { createClient } from "@/lib/supabase-server";
import { ClientProfile } from "./_components/client-profile";

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
    .select("id, name, telegram_id, status, payment_status, program_id, connect_code, spreadsheet_id, language, timezone, morning_time, measurement_time, measurement_day, access_start_date, access_end_date, legacy_id, created_at, updated_at, program:programs(id, title, active, template_file_url)")
    .eq("id", id)
    .single();

  if (error || !client) {
    notFound();
  }

  async function safeFetch<T>(
    query: PromiseLike<{ data: T | null; error: unknown }>,
    fallback: T | null,
  ): Promise<{ data: T | null }> {
    try {
      const result = await query;
      return { data: result.data ?? fallback };
    } catch {
      return { data: fallback };
    }
  }

  async function safeCount(
    query: PromiseLike<{ count: number | null; error: unknown }>,
  ): Promise<{ count: number }> {
    try {
      const result = await query;
      return { count: result.count ?? 0 };
    } catch {
      return { count: 0 };
    }
  }

  const [
    latestCheckinResult,
    latestMeasurementResult,
    workoutCountResult,
    checkinCountResult,
    messageCountResult,
    scheduleResult,
  ] = await Promise.all([
    safeFetch(
      supabase.from("checkins").select("date, wellbeing, sleep, stress, nutrition_adherence, missed_workouts, complaints").eq("client_id", id).order("date", { ascending: false }).limit(1).maybeSingle(),
      null,
    ),
    safeFetch(
      supabase.from("measurements").select("date, weight, waist, chest, hips").eq("client_id", id).order("date", { ascending: false }).limit(1).maybeSingle(),
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
  ]);

  return (
    <div className="p-6">
      <ClientProfile
        client={client}
        latestCheckin={latestCheckinResult.data}
        latestMeasurement={latestMeasurementResult.data}
        workoutCount={workoutCountResult.count}
        checkinCount={checkinCountResult.count}
        messageCount={messageCountResult.count}
        schedule={scheduleResult.data ?? []}
      />
    </div>
  );
}
