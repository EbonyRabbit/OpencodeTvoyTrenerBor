import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { verifySession } from "@/lib/dal";
import { createClient } from "@/lib/supabase-server";
import { ProgramDetail } from "./_components/program-detail";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("programs").select("id, title").eq("id", id);
  const program = (data as { id: string; title: string }[] | null)?.[0];
  return {
    title: program?.title ?? "Программа",
  };
}

export default async function ProgramDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await verifySession();

  if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const supabase = await createClient();

  const { data: program, error } = await supabase
    .from("programs")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !program) {
    notFound();
  }

  const { count: clientCount } = await supabase
    .from("clients")
    .select("*", { count: "exact", head: true })
    .eq("program_id", id);

  return (
    <div className="p-6">
      <ProgramDetail
        program={program}
        clientCount={clientCount ?? 0}
      />
    </div>
  );
}
