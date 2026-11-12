import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Database } from "@/types/supabase";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { resetDb } from "@/test/integration/db";

async function seedClient() {
  const id = randomUUID();
  const { error } = await supabaseAdmin.from("clients").insert({
    id,
    name: "Sub Test",
    status: "active",
  });
  if (error) throw error;
  return id;
}

async function seedPlan() {
  const { data, error } = await supabaseAdmin
    .from("subscription_plans")
    .insert({
      code: "test-monthly",
      title: "Test plan",
      price: 4900.0,
      period_days: 30,
    })
    .select("id, price, period_days, active")
    .single();
  if (error) throw error;
  return data;
}

async function getSeededPlan() {
  const { data, error } = await supabaseAdmin
    .from("subscription_plans")
    .select("id, price, period_days, active")
    .eq("code", "test-monthly")
    .single();
  if (error) throw error;
  return data;
}

function in30Days() {
  return new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
}

type SubscriptionStatus =
  Database["public"]["Tables"]["subscriptions"]["Row"]["status"];

async function insertSubscription(
  clientId: string,
  planId: string,
  status: SubscriptionStatus,
) {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .insert({
      client_id: clientId,
      plan_id: planId,
      status,
      current_period_start: new Date().toISOString(),
      current_period_end: in30Days(),
    })
    .select("id, current_period_end")
    .single();
  if (error) throw error;
  return data;
}

beforeEach(async () => {
  resetDb();
  await seedPlan();
});

describe("subscription schema", () => {
  it("stores a plan with price and period", async () => {
    const plan = await getSeededPlan();
    expect(plan.period_days).toBe(30);
    expect(plan.price).toBeGreaterThan(0);
    expect(plan.active).toBe(true);
  });

  it("syncs clients.access_end_date to the live subscription", async () => {
    const clientId = await seedClient();
    const plan = await getSeededPlan();
    const sub = await insertSubscription(clientId, plan.id, "active");

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("access_end_date")
      .eq("id", clientId)
      .single();
    expect(new Date(client?.access_end_date ?? 0).getTime()).toBe(
      new Date(sub.current_period_end!).getTime(),
    );

    // Cancelled subscription no longer counts as live access: the trigger
    // never writes NULL (the bot gate treats NULL as unlimited access), so the
    // last known period end stays and the lazy expiry gate cuts it later.
    const { error: cancelError } = await supabaseAdmin
      .from("subscriptions")
      .update({ status: "cancelled" })
      .eq("id", sub.id);
    expect(cancelError).toBeNull();
    const { data: cancelled } = await supabaseAdmin
      .from("clients")
      .select("access_end_date")
      .eq("id", clientId)
      .single();
    expect(new Date(cancelled?.access_end_date ?? 0).getTime()).toBe(
      new Date(sub.current_period_end!).getTime(),
    );
  });

  it("keeps access_end_date when the only live subscription is deleted", async () => {
    const clientId = await seedClient();
    const plan = await getSeededPlan();
    const sub = await insertSubscription(clientId, plan.id, "active");

    // DELETE path must behave like cancel: never write NULL (the bot gate
    // treats NULL as unlimited access), keep the last known period end.
    const { error: deleteError } = await supabaseAdmin
      .from("subscriptions")
      .delete()
      .eq("id", sub.id);
    expect(deleteError).toBeNull();
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("access_end_date")
      .eq("id", clientId)
      .single();
    expect(new Date(client?.access_end_date ?? 0).getTime()).toBe(
      new Date(sub.current_period_end!).getTime(),
    );
  });

  it("ignores pending subscriptions for access_end_date", async () => {
    const clientId = await seedClient();
    const plan = await getSeededPlan();
    const sub = await insertSubscription(clientId, plan.id, "pending");

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("access_end_date")
      .eq("id", clientId)
      .single();
    expect(client?.access_end_date).toBeNull();

    // Activation promotes it to a live period.
    const { error: activateError } = await supabaseAdmin
      .from("subscriptions")
      .update({ status: "active" })
      .eq("id", sub.id);
    expect(activateError).toBeNull();
    const { data: activated } = await supabaseAdmin
      .from("clients")
      .select("access_end_date")
      .eq("id", clientId)
      .single();
    expect(new Date(activated?.access_end_date ?? 0).getTime()).toBe(
      new Date(sub.current_period_end!).getTime(),
    );
  });

  it("allows only one live subscription per client", async () => {
    const clientId = await seedClient();
    const plan = await getSeededPlan();
    const sub = await insertSubscription(clientId, plan.id, "active");

    const { error } = await supabaseAdmin.from("subscriptions").insert({
      client_id: clientId,
      plan_id: plan.id,
      status: "past_due",
      current_period_start: new Date().toISOString(),
      current_period_end: in30Days(),
    });
    expect(error).toBeTruthy();

    // After the first expires, a new one is allowed.
    const { error: expireError } = await supabaseAdmin
      .from("subscriptions")
      .update({ status: "expired" })
      .eq("id", sub.id);
    expect(expireError).toBeNull();

    const { error: insertError } = await supabaseAdmin
      .from("subscriptions")
      .insert({
        client_id: clientId,
        plan_id: plan.id,
        status: "active",
        current_period_start: new Date().toISOString(),
        current_period_end: in30Days(),
      });
    expect(insertError).toBeNull();
  });

  it("deletes subscription payments with the subscription", async () => {
    const clientId = await seedClient();
    const plan = await getSeededPlan();
    const sub = await insertSubscription(clientId, plan.id, "active");

    const { error: payError } = await supabaseAdmin
      .from("subscription_payments")
      .insert({
        subscription_id: sub.id,
        order_id: "order-1",
        amount: plan.price,
        status: "success",
        paid_at: new Date().toISOString(),
        period_start: new Date().toISOString(),
        period_end: in30Days(),
      });
    expect(payError).toBeNull();

    const { error: delError } = await supabaseAdmin
      .from("subscriptions")
      .delete()
      .eq("id", sub.id);
    expect(delError).toBeNull();

    const { data: payments } = await supabaseAdmin
      .from("subscription_payments")
      .select("id")
      .eq("subscription_id", sub.id);
    expect(payments).toHaveLength(0);
  });
});
