import { verifySession } from "@/lib/dal";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import {
  VALID_CLIENT_STATUSES,
  VALID_PAYMENT_FILTERS,
  escapeSearch,
  type ClientFilter,
  type PaymentFilter,
} from "@/lib/clients";
import { ClientsTable } from "./_components/clients-table";
import { ClientFilters } from "./_components/client-filters";

const PAGE_SIZE = 10;

function buildQuery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  status: ClientFilter,
  search: string,
  payment: PaymentFilter,
) {
  let query = supabase
    .from("clients")
    .select(
      "id, name, telegram_id, status, payment_status, language, timezone, access_start_date, access_end_date, created_at, program_id, program:programs(title)",
      { count: "exact" },
    );

  if (status !== "all") {
    query = query.eq("status", status);
  }

  if (search) {
    query = query.ilike("name", `%${escapeSearch(search)}%`);
  }

  if (payment !== "all") {
    query = query.eq("payment_status", payment);
  }

  return query;
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string; payment?: string }>;
}) {
  const { profile } = await verifySession();

  if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const rawPage = Math.max(1, Number(params.page) || 1);
  const status = VALID_CLIENT_STATUSES.includes(params.status as ClientFilter)
    ? (params.status as ClientFilter)
    : "all";
  const search = params.q?.trim() ?? "";
  const payment = VALID_PAYMENT_FILTERS.includes(params.payment as PaymentFilter)
    ? (params.payment as PaymentFilter)
    : "all";

  const supabase = await createClient();
  const from = (rawPage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data: clients, count, error } = await buildQuery(supabase, status, search, payment)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">Клиенты</h1>
        <p className="mt-4 text-destructive">Ошибка загрузки клиентов. Попробуйте позже.</p>
      </div>
    );
  }

  const totalCount = count ?? 0;
  const totalPages = totalCount > 0 ? Math.ceil(totalCount / PAGE_SIZE) : 0;
  const safePage = totalPages > 0 ? Math.min(rawPage, totalPages) : 1;

  let displayClients = clients ?? [];
  if (safePage !== rawPage) {
    const safeFrom = (safePage - 1) * PAGE_SIZE;
    const safeTo = safeFrom + PAGE_SIZE - 1;
    const { data: corrected } = await buildQuery(supabase, status, search, payment)
      .order("created_at", { ascending: false })
      .range(safeFrom, safeTo);
    displayClients = corrected ?? [];
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Клиенты</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Управление клиентами
          </p>
        </div>
      </div>

      <ClientFilters currentStatus={status} currentPayment={payment} currentSearch={search} />

      <ClientsTable
        clients={displayClients}
        totalCount={totalCount}
        page={safePage}
        totalPages={totalPages}
        currentStatus={status}
        currentSearch={search}
        currentPayment={payment}
      />
    </div>
  );
}
