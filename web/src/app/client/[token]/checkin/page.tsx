import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { safeFetch } from "@/lib/safe-fetch";
import { getTodayDateStr } from "@/lib/photos";
import type { Database } from "@/types/supabase";
import { CheckinForm } from "./checkin-form";
import { CheckinHistory } from "./checkin-history";

const DEFAULT_TIMEZONE = "Europe/Moscow";
const HISTORY_LIMIT = 10;

type CheckinRow = Database["public"]["Tables"]["checkins"]["Row"];

export default async function CheckinPage() {
  const h = await headers();
  const clientId = h.get("x-client-id");
  if (!clientId) notFound();

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, timezone")
    .eq("id", clientId)
    .maybeSingle<{ id: string; timezone: string | null }>();

  if (!client) notFound();

  const tz = client.timezone || DEFAULT_TIMEZONE;
  const date = getTodayDateStr(tz);

  const [{ data: todayCheckin }, { data: historyData }] = await Promise.all([
    safeFetch(
      supabaseAdmin
        .from("checkins")
        .select("*")
        .eq("client_id", clientId)
        .eq("date", date)
        .order("created_at", { ascending: false })
        .maybeSingle<CheckinRow>(),
      null,
    ),
    safeFetch(
      supabaseAdmin
        .from("checkins")
        .select("*")
        .eq("client_id", clientId)
        .order("date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(HISTORY_LIMIT),
      [] as CheckinRow[],
    ),
  ]);

  const history = historyData ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Чек-ин</h2>
        <p className="text-sm text-muted-foreground">
          Расскажите о самочувствии и придержании плана
        </p>
      </div>
      <CheckinForm existing={todayCheckin} />
      <CheckinHistory checkins={history} />
    </div>
  );
}
