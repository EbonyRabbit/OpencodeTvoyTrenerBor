import { supabaseAdmin } from "@/lib/supabase-admin";
import type { ClientRow } from "@/lib/clients";

export async function lazyExpireAccess(client: ClientRow): Promise<boolean> {
  if (client.status !== "active" || !client.access_end_date) return false;
  if (new Date(client.access_end_date).getTime() >= Date.now()) return false;

  const pauseResult = await supabaseAdmin
    .from("plan_pauses")
    .select("id")
    .eq("client_id", client.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (pauseResult.error) {
    console.error("[client-access] Pause check failed:", pauseResult.error.message);
    return false;
  }
  if (pauseResult.data) return false;

  const subResult = await supabaseAdmin
    .from("subscriptions")
    .select("id")
    .eq("client_id", client.id)
    .in("status", ["active", "past_due"])
    .limit(1)
    .maybeSingle();
  if (subResult.error) {
    console.error(
      "[client-access] Subscription check failed:",
      subResult.error.message,
    );
    return false;
  }
  if (subResult.data) return false;

  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("clients")
    .update({ status: "access_expired" })
    .eq("id", client.id)
    .eq("status", "active")
    .lt("access_end_date", nowIso)
    .select("id");
  if (error) {
    console.error("[client-access] Failed to expire access:", error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}
