import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { CLIENT_STATUS_LABELS, type ClientRow } from "@/lib/clients";

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
  { href: "/measurements", label: "Замеры" },
  { href: "/photos", label: "Фото" },
  { href: "/checkin", label: "Чек-ин" },
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

  const programTitle = client.program_title;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
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
        <nav className="mt-3 flex gap-4 text-sm">
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
      <main className="flex-1 px-6 py-6">{children}</main>
    </div>
  );
}
