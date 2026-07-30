import { verifySession } from "@/lib/dal";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { VALID_STATUSES, type ProgramFilter, type ProgramRow } from "@/lib/programs";
import { ProgramsList } from "./_components/programs-list";
import { ProgramFilters } from "./_components/program-filters";
import { CreateProgramDialog } from "./_components/create-program-dialog";

const PAGE_SIZE = 10;

function buildQuery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  status: ProgramFilter,
) {
  let query = supabase
    .from("programs")
    .select("id, title, description, equipment, price, template_id, active, type, language, duration_weeks, parsed_content, created_at", { count: "exact" });

  if (status === "draft") {
    query = query.eq("active", false).is("parsed_content", null);
  } else if (status === "active") {
    query = query.eq("active", true);
  } else if (status === "archived") {
    query = query.eq("active", false).not("parsed_content", "is", null);
  }

  return query;
}

export default async function ProgramsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const { profile } = await verifySession();

  if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const status = VALID_STATUSES.includes(params.status as ProgramFilter)
    ? (params.status as ProgramFilter)
    : "all";

  const supabase = await createClient();
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const query = buildQuery(supabase, status)
    .order("created_at", { ascending: false })
    .range(from, to);

  const { data: rawPrograms, count, error } = await query;
  const programs = rawPrograms as ProgramRow[] | null;

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">Программы</h1>
        <p className="mt-4 text-destructive">Ошибка загрузки программ. Попробуйте позже.</p>
      </div>
    );
  }

  const totalCount = count ?? 0;
  const totalPages = totalCount > 0 ? Math.ceil(totalCount / PAGE_SIZE) : 0;
  const safePage = totalPages > 0 ? Math.min(page, totalPages) : 1;

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Программы</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Управление программами тренировок
          </p>
        </div>
        <CreateProgramDialog />
      </div>

      <ProgramFilters currentStatus={status} />

      <ProgramsList
        programs={programs ?? []}
        totalCount={count ?? 0}
        page={safePage}
        totalPages={totalPages}
        currentStatus={status}
      />
    </div>
  );
}
