import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { verifySession } from "@/lib/dal";
import { createClient } from "@/lib/supabase-server";
// import { supabaseAdmin } from "@/lib/supabase-admin"; // DISABLED: photo storage removed
import { getParsedContent } from "@/lib/program-utils";
import { safeFetch } from "@/lib/safe-fetch";
import { resolveWorkoutCount } from "@/lib/workout-stats";
import { getNextWorkoutDay } from "@/lib/next-workout";
import { getTodayDateStr } from "@/lib/date-utils";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { getActiveProgramPeriod, NIL_PERIOD_ID } from "@/lib/program-periods";
import { getEffectiveAccessForClient } from "@/lib/effective-access-server";
import type { Database } from "@/types/supabase";
import { ClientProfile } from "./_components/client-profile";
import { ExerciseSwapsSection } from "./_components/exercise-swaps-section";
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
    .select("id, name, telegram_id, status, payment_status, program_id, connect_code, spreadsheet_id, language, timezone, training_days, morning_time, access_start_date, access_end_date, purchase_date, created_at, updated_at, program:programs!clients_program_id_fkey(id, title, active, template_file_url, parsed_content)")
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

  const today = getTodayDateStr(typedClient.timezone || DEFAULT_TIMEZONE);

  // 30.6: карточка клиента показывает активный период.
  const activePeriod = await getActiveProgramPeriod(id);
  const activePeriodId = activePeriod?.id ?? NIL_PERIOD_ID;

  const [
    workoutCountResult,
    scheduleResult,
    workoutLogsResult,
    purchaseRequestsResult,
    access,
  ] = await Promise.all([
    supabase.rpc("count_client_workout_days", { p_client_id: id }),
    safeFetch(
      supabase.from("program_schedule").select("id, week_number, focus, start_date, end_date, training_days").eq("client_id", id).eq("program_period_id", activePeriodId).order("week_number", { ascending: true }).limit(52),
      [],
    ),
    safeFetch(
      supabase.from("workout_logs").select("date, exercise, week, day_order").eq("client_id", id).eq("program_period_id", activePeriodId),
      [],
    ),
    safeFetch(
      (() => {
        const query = supabase
          .from("purchase_requests")
          .select("id, sub_type, status, amount, created_at, paid_at, program:programs!purchase_requests_program_id_fkey(id, title)")
          .order("created_at", { ascending: false })
          .limit(20);
        return typedClient.telegram_id != null
          ? query.or(`client_id.eq.${id},and(client_id.is.null,telegram_id.eq.${typedClient.telegram_id})`)
          : query.eq("client_id", id);
      })(),
      [],
    ),
    getEffectiveAccessForClient(typedClient),
  ]);

  const parsedContent = typedClient.program ? getParsedContent(typedClient.program) : null;

  const nextWorkout = getNextWorkoutDay({
    schedule: scheduleResult.data ?? [],
    clientTrainingDays: typedClient.training_days,
    parsed: parsedContent,
    workoutLogs: workoutLogsResult.data ?? [],
    today,
  });

  const workoutCount = resolveWorkoutCount(workoutCountResult);
  if (workoutCountResult.error) {
    console.error("Failed to count client workout days:", workoutCountResult.error);
  }

  const activityResult = await getClientActivity(id);
  const initialActivityEvents =
    "events" in activityResult ? activityResult.events : [];

  return (
    <div className="p-6">
      <ClientProfile
        client={typedClient}
        workoutCount={workoutCount}
        schedule={scheduleResult.data ?? []}
        parsedContent={parsedContent}
        nextWorkout={nextWorkout}
        initialActivityEvents={initialActivityEvents}
        loadMoreActivity={loadMoreActivity.bind(null, id)}
        purchaseRequests={purchaseRequestsResult.data ?? []}
        access={access}
      />
      <div className="mx-auto mt-6 max-w-4xl">
        <ExerciseSwapsSection clientId={id} />
      </div>
    </div>
  );
}
