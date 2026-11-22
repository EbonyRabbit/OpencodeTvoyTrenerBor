import type { Client } from "./clients.js";
import { supabaseAdmin } from "./supabase-admin.js";

type AccessClient = Pick<Client, "id" | "status" | "payment_status" | "access_end_date">;

export async function findLiveSubscription(clientId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select("id")
    .eq("client_id", clientId)
    .in("status", ["active", "past_due"])
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Subscription check failed for ${clientId}: ${error.message}`);
  }
  return data !== null;
}

async function hasActivePause(clientId: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from("plan_pauses")
      .select("id")
      .eq("client_id", clientId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[CLIENT_ACCESS] Pause check failed:", error.message);
      return false;
    }
    return Boolean(data);
  } catch (err) {
    console.error("[CLIENT_ACCESS] Pause check failed:", err);
    return false;
  }
}

export async function hasClientAccess(
  client: AccessClient,
  options: { allowExpiredPaid?: boolean } = {},
  now: Date = new Date(),
): Promise<boolean> {
  if (client.status !== "active") return false;
  if (client.payment_status === "paid") {
    if (options.allowExpiredPaid || hasValidPaidAccess(client, now)) return true;
    if (await hasActivePause(client.id)) return true;
  }
  try {
    return await findLiveSubscription(client.id);
  } catch (err) {
    console.error("[CLIENT_ACCESS] Subscription check failed:", err);
    return false;
  }
}

export async function filterClientsWithAccess<T extends AccessClient>(
  clients: T[],
  now: Date = new Date(),
): Promise<T[]> {
  const active = clients.filter((client) => client.status === "active");
  if (active.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select("client_id")
    .in("client_id", active.map((client) => client.id))
    .in("status", ["active", "past_due"]);

  if (error) {
    console.error("[CLIENT_ACCESS] Bulk subscription check failed:", error.message);
    return active.filter((client) => hasValidPaidAccess(client, now));
  }

  const subscribedIds = new Set((data ?? []).map((row) => row.client_id));
  return active.filter(
    (client) => subscribedIds.has(client.id) || hasValidPaidAccess(client, now),
  );
}

function hasValidPaidAccess(client: AccessClient, now: Date): boolean {
  if (client.payment_status !== "paid") return false;
  if (!client.access_end_date) return true;
  const end = Date.parse(client.access_end_date);
  return Number.isFinite(end) && end >= now.getTime();
}
