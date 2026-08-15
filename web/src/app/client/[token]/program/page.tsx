import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getParsedContent } from "@/lib/program-utils";
import { ProgramWeekPreview } from "@/app/(coach)/programs/[id]/_components/program-week-preview";

export default async function ClientProgramPage() {
  const h = await headers();
  const clientId = h.get("x-client-id");
  if (!clientId) notFound();

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("program_id")
    .eq("id", clientId)
    .maybeSingle<{ program_id: string | null }>();
  if (!client?.program_id) notFound();

  const { data: program } = await supabaseAdmin
    .from("programs")
    .select("*")
    .eq("id", client.program_id)
    .maybeSingle();
  if (!program) notFound();

  const parsed = getParsedContent(program);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">{program.title}</h2>
        {program.description && (
          <p className="mt-1 text-sm text-muted-foreground">{program.description}</p>
        )}
      </div>
      <ProgramWeekPreview parsed={parsed} />
    </div>
  );
}
