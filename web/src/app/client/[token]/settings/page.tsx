import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { ClientRow } from "@/lib/clients";
import { SettingsForm } from "./settings-form";

type SettingsClient = Pick<
  ClientRow,
  "language" | "timezone" | "morning_time" | "measurement_time" | "measurement_day" | "training_days"
>;

export default async function SettingsPage() {
  const h = await headers();
  const clientId = h.get("x-client-id");
  if (!clientId) notFound();

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("language, timezone, morning_time, measurement_time, measurement_day, training_days, program_id")
    .eq("id", clientId)
    .maybeSingle<SettingsClient & { program_id: string | null }>();

  if (!client) notFound();

  let programDayOrders: number[] = [];
  if (client.program_id) {
    const { data: program } = await supabaseAdmin
      .from("programs")
      .select("parsed_content")
      .eq("id", client.program_id)
      .maybeSingle<{ parsed_content: unknown }>();

    const content = program?.parsed_content as
      | { weeks?: { week_number: number; days?: { day_order: number; exercises?: unknown[] }[] }[] }
      | null
      | undefined;

    const firstWeek = content?.weeks?.[0];
    if (firstWeek?.days) {
      programDayOrders = firstWeek.days
        .filter((d) => (d.exercises?.length ?? 0) > 0)
        .map((d) => d.day_order)
        .sort((a, b) => a - b);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Настройки</h2>
        <p className="text-sm text-muted-foreground">
          Управляйте уведомлениями, языком и расписанием тренировок
        </p>
      </div>
      <SettingsForm client={client} programDayOrders={programDayOrders} />
    </div>
  );
}
