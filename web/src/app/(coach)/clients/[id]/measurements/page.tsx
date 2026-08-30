import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { verifySession } from "@/lib/dal";
import { createClient } from "@/lib/supabase-server";
import { safeFetch, safeCount } from "@/lib/safe-fetch";
import { MeasurementsTable } from "./_components/measurements-table";
import { MeasurementTrends } from "./_components/measurement-trends";

const PAGE_SIZE = 25;

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
    title: data?.name ? `Замеры - ${data.name}` : "Замеры",
  };
}

export default async function MeasurementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const [session, { id }, sp] = await Promise.all([
    verifySession(),
    params,
    searchParams,
  ]);
  const { profile, supabase } = session;

  if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
    redirect("/dashboard");
  }

  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", id)
    .maybeSingle<{ id: string; name: string }>();

  if (!client) {
    notFound();
  }

  const rawPage = parseInt(sp.page ?? "1", 10) || 1;
  const currentPage = Math.max(1, rawPage);

  const [
    { data: measurements },
    { count },
    { data: chartData },
  ] = await Promise.all([
    safeFetch(
      supabase
        .from("measurements")
        .select("*")
        .eq("client_id", id)
        .order("date", { ascending: false })
        .range((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE - 1),
      [],
    ),
    safeCount(
      supabase
        .from("measurements")
        .select("*", { count: "exact", head: true })
        .eq("client_id", id),
    ),
    safeFetch(
      supabase
        .from("measurements")
        .select("date, weight, waist, abdomen, chest, hips, glutes, left_thigh, right_thigh, left_arm, right_arm, body_fat, muscle_mass, visceral_fat")
        .eq("client_id", id)
        .order("date", { ascending: false })
        .limit(20),
      [],
    ),
  ]);

  const chartHistory = [...(chartData ?? [])].reverse();

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const clampedPage = Math.min(currentPage, totalPages);

  if (clampedPage !== currentPage) {
    redirect(`/clients/${id}/measurements?page=${clampedPage}`);
  }

  return (
    <div className="p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <MeasurementTrends data={chartHistory} />
        <MeasurementsTable
          clientId={client.id}
          clientName={client.name}
          measurements={measurements ?? []}
          currentPage={currentPage}
          totalPages={totalPages}
        />
      </div>
    </div>
  );
}
