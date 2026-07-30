import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { ClientRow } from "@/lib/clients";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const h = await headers();
  const clientId = h.get("x-client-id");
  if (!clientId) notFound();

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("language, timezone, morning_time, measurement_time, measurement_day")
    .eq("id", clientId)
    .maybeSingle<Pick<ClientRow, "language" | "timezone" | "morning_time" | "measurement_time" | "measurement_day">>();

  if (!client) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Настройки</h2>
        <p className="text-sm text-muted-foreground">
          Управляйте уведомлениями и языком
        </p>
      </div>
      <SettingsForm client={client} />
    </div>
  );
}
