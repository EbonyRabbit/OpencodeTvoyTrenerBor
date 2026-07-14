import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { ClientRow } from "@/lib/clients";
import { MeasurementsForm } from "./measurements-form";

const DEFAULT_TIMEZONE = "Europe/Moscow";

function getTodayDateStr(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

export default async function MeasurementsPage() {
  const h = await headers();
  const clientId = h.get("x-client-id");
  if (!clientId) notFound();

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, timezone")
    .eq("id", clientId)
    .maybeSingle<Pick<ClientRow, "id" | "timezone">>();

  if (!client) notFound();

  const tz = client.timezone || DEFAULT_TIMEZONE;
  const date = getTodayDateStr(tz);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Замеры тела</h2>
        <p className="text-sm text-muted-foreground">
          Запишите текущие параметры тела
        </p>
      </div>
      <MeasurementsForm date={date} />
    </div>
  );
}
