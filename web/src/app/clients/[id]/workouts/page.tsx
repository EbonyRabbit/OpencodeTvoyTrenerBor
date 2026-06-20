import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { verifySession } from "@/lib/dal";
import { createClient } from "@/lib/supabase-server";
import { safeFetch } from "@/lib/safe-fetch";
import { getParsedContent } from "@/lib/program-utils";
import type { Database } from "@/types/supabase";
import { calculateAdherence } from "@/lib/adherence";
import { WorkoutView } from "./_components/workout-view";

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
    title: data?.name ? `Дисциплина — ${data.name}` : "Дисциплина",
  };
}

export default async function WorkoutsPage({
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

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, program_id")
    .eq("id", id)
    .maybeSingle<{ id: string; name: string; program_id: string | null }>();

  if (!client) {
    notFound();
  }

  let programTitle: string | null = null;
  let parsedContent: ReturnType<typeof getParsedContent> = null;

  if (client.program_id) {
    const { data: program } = await supabase
      .from("programs")
      .select("id, title, parsed_content")
      .eq("id", client.program_id)
      .maybeSingle();
    if (program) {
      programTitle = program.title;
      const programRow = program as Database["public"]["Tables"]["programs"]["Row"];
      parsedContent = getParsedContent(programRow);
    }
  }

  const [{ data: schedule }, { data: workoutLogs }] = await Promise.all([
    safeFetch(
      supabase
        .from("program_schedule")
        .select("week_number, start_date, end_date, focus")
        .eq("client_id", id)
        .order("week_number", { ascending: true }),
      [],
    ),
    safeFetch(
      supabase
        .from("workout_logs")
        .select("date")
        .eq("client_id", id)
        .order("date", { ascending: false }),
      [],
    ),
  ]);

  const { weeks, overallAdherence, totalCompleted, totalExpected } = calculateAdherence(
    schedule ?? [],
    parsedContent,
    workoutLogs ?? [],
  );

  return (
    <div className="p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <WorkoutView
          clientId={client.id}
          clientName={client.name}
          programName={programTitle}
          weeks={weeks}
          overallAdherence={overallAdherence}
          totalCompleted={totalCompleted}
          totalExpected={totalExpected}
          hasSchedule={schedule !== null && schedule.length > 0}
          hasWorkoutLogs={workoutLogs !== null && workoutLogs.length > 0}
          hasParsedContent={parsedContent !== null}
        />
      </div>
    </div>
  );
}
