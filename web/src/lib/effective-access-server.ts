import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Database } from "@/types/supabase";
import {
  getEffectiveAccess,
  type EffectiveAccess,
  type EffectiveAccessSubscription,
} from "./effective-access";

type ClientWithId = Pick<
  Database["public"]["Tables"]["clients"]["Row"],
  "id" | "status" | "payment_status" | "access_end_date"
>;

export async function getEffectiveAccessForClient(
  client: ClientWithId,
  now: Date = new Date(),
): Promise<EffectiveAccess> {
  const [subscriptionResult, pauseResult] = await Promise.all([
    supabaseAdmin
      .from("subscriptions")
      .select("status, current_period_end, cancel_at_period_end")
      .eq("client_id", client.id)
      .in("status", ["active", "past_due"])
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("plan_pauses")
      .select("id")
      .eq("client_id", client.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
  ]);

  if (subscriptionResult.error) {
    console.error(
      "[effective-access] Subscription lookup failed:",
      subscriptionResult.error.message,
    );
  }
  if (pauseResult.error) {
    console.error(
      "[effective-access] Pause lookup failed:",
      pauseResult.error.message,
    );
  }

  return getEffectiveAccess(
    client,
    (subscriptionResult.data as EffectiveAccessSubscription | null) ?? null,
    now,
    pauseResult.data !== null,
  );
}

export function accessDeniedError(
  client: Pick<ClientWithId, "payment_status">,
  access: EffectiveAccess,
): string {
  if (client.payment_status === "pending" && !access.subscriptionStatus) {
    return "Сначала подтвердите оплату";
  }
  return "Нет активного доступа. Проверьте подписку или оплату";
}
