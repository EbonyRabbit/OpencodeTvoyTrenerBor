import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { CLIENT_STATUS_LABELS, type ClientRow } from "@/lib/clients";
import { ConsentScreen } from "./_components/consent-screen";
import { PRIVACY_POLICY_VERSION } from "@/lib/consent";

/**
 * Ленивое автоистечение доступа (21.10): активный клиент с прошедшим
 * access_end_date помечается status='access_expired' и отправляется на
 * /client/expired. Условный UPDATE (status=active + lt access_end_date)
 * делает операцию идемпотентной: продлённый доступ не перезаписывается.
 * Возвращает true только если истечение реально применено.
 */
async function lazyExpireAccess(client: ClientRow): Promise<boolean> {
  if (client.status !== "active" || !client.access_end_date) return false;
  if (new Date(client.access_end_date).getTime() >= Date.now()) return false;

  // Активная пауза - доступ не истекает во время паузы.
  const { data: pause } = await supabaseAdmin
    .from("plan_pauses")
    .select("id")
    .eq("client_id", client.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (pause) return false;

  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("clients")
    .update({ status: "access_expired" })
    .eq("id", client.id)
    .eq("status", "active")
    .lt("access_end_date", nowIso)
    .select("id");
  if (error) {
    console.error("[client-layout] Failed to expire access:", error.message);
    return false;
  }
  // 0 строк = дату успели продлить в гонке - доступ остаётся активным.
  return Array.isArray(data) && data.length > 0;
}

async function getClientData(clientId: string): Promise<(ClientRow & { program_title: string | null }) | null> {
  const { data: client, error } = await supabaseAdmin
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle<ClientRow>();
  if (error) {
    console.error("[client-layout] Failed to fetch client:", error.message);
    return null;
  }
  if (!client) return null;

  let program_title: string | null = null;
  if (client.program_id) {
    const { data: program } = await supabaseAdmin
      .from("programs")
      .select("title")
      .eq("id", client.program_id)
      .maybeSingle<{ title: string }>();
    program_title = program?.title ?? null;
  }

  return { ...client, program_title };
}

const NAV_ITEMS = [
  { href: "", label: "Главная" },
  { href: "/program", label: "Программа" },
  { href: "/workout", label: "Тренировка" },
  { href: "/history", label: "История" },
  { href: "/measurements", label: "Замеры" },
  { href: "/photos", label: "Фото" },
  { href: "/checkin", label: "Чек-ин" },
  { href: "/settings", label: "Настройки" },
] as const;

export default async function ClientPortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const h = await headers();
  const clientId = h.get("x-client-id");

  if (!clientId) {
    notFound();
  }

  const client = await getClientData(clientId);
  if (!client) {
    notFound();
  }

  if (await lazyExpireAccess(client)) {
    redirect("/client/expired");
  }

  // Fallback для клиентов, истёкших до внедрения ленивого автоистечения
  // или помеченных вручную (proxy их не пускает только при смене статуса).
  if (client.status === "access_expired") {
    redirect("/client/expired");
  }

  if (!client.client_consent_given) {
    return (
      <ConsentScreen
        token={token}
        clientName={client.name}
        privacyPolicyVersion={PRIVACY_POLICY_VERSION}
      />
    );
  }

  const programTitle = client.program_title;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold">{client.name}</h1>
            {programTitle && (
              <p className="text-sm text-muted-foreground">{programTitle}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {CLIENT_STATUS_LABELS[client.status] ?? client.status}
            </span>
            {client.access_end_date && (
              <span className="text-xs text-muted-foreground">
                до {new Date(client.access_end_date).toLocaleDateString("ru-RU")}
              </span>
            )}
          </div>
        </div>
        <nav className="mt-3 flex flex-wrap gap-3 text-sm">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={`/client/${token}${item.href}`}
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
