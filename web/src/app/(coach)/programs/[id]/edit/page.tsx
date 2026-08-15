import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { verifySession } from "@/lib/dal";
import { createClient } from "@/lib/supabase-server";
import { getParsedContent } from "@/lib/program-utils";
import { ProgramEditor } from "./_components/program-editor";

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
    title: program ? `Редактирование: ${program.title}` : "Редактирование программы",
  };
}

export default async function ProgramEditPage({
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

  const parsedContent = getParsedContent(program);

  return (
    <div className="p-6">
      <ProgramEditor program={program} parsedContent={parsedContent} />
    </div>
  );
}
