import type { Database } from "@/types/supabase";

type ClientAccessFields = Pick<
  Database["public"]["Tables"]["clients"]["Row"],
  "status" | "payment_status" | "access_end_date"
>;

export type EffectiveAccessSubscription = Pick<
  Database["public"]["Tables"]["subscriptions"]["Row"],
  "status" | "current_period_end" | "cancel_at_period_end"
>;

export type EffectiveAccessSource = "subscription" | "legacy_paid" | "none";

export type EffectiveAccess = {
  active: boolean;
  source: EffectiveAccessSource;
  endDate: string | null;
  isExpired: boolean;
  showPaymentWarning: boolean;
  cancelAtPeriodEnd: boolean;
  subscriptionStatus: "active" | "past_due" | null;
  paused: boolean;
};

function isFutureOrMissing(date: string | null, now: Date): boolean {
  if (!date) return true;
  const timestamp = Date.parse(date);
  return Number.isFinite(timestamp) && timestamp >= now.getTime();
}

function isPast(date: string | null, now: Date): boolean {
  if (!date) return false;
  const timestamp = Date.parse(date);
  return !Number.isFinite(timestamp) || timestamp < now.getTime();
}

export function getEffectiveAccess(
  client: ClientAccessFields,
  subscription: EffectiveAccessSubscription | null,
  now: Date = new Date(),
  hasActivePause = false,
): EffectiveAccess {
  const subscriptionStatus =
    subscription?.status === "active" || subscription?.status === "past_due"
      ? subscription.status
      : null;

  if (subscription && subscriptionStatus) {
    return {
      active: client.status === "active",
      source: "subscription",
      endDate: subscription.current_period_end,
      isExpired: client.status === "access_expired",
      showPaymentWarning: false,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      subscriptionStatus,
      paused: hasActivePause,
    };
  }

  const paid = client.status === "active" && client.payment_status === "paid";
  const legacyPaid =
    paid &&
    (hasActivePause || isFutureOrMissing(client.access_end_date, now));
  const expired =
    client.status === "access_expired" ||
    (paid && !hasActivePause && isPast(client.access_end_date, now));

  return {
    active: legacyPaid,
    source: legacyPaid ? "legacy_paid" : "none",
    endDate: client.access_end_date,
    isExpired: expired,
    showPaymentWarning: client.payment_status === "pending",
    cancelAtPeriodEnd: false,
    subscriptionStatus: null,
    paused: hasActivePause,
  };
}
