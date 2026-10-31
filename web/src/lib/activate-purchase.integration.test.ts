import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { activatePurchaseByOrder } from "@/lib/activate-purchase";
import { resetDb } from "@/test/integration/db";
import type { Database } from "@/types/supabase";

const mocks = vi.hoisted(() => ({
  generateSchedule: vi.fn(),
  sendTelegramMessage: vi.fn(),
}));

vi.mock("@/lib/plan-adjustment", () => ({
  generateSchedule: mocks.generateSchedule,
}));

vi.mock("@/lib/telegram", () => ({
  sendTelegramMessage: mocks.sendTelegramMessage,
}));

const TELEGRAM_ID = 777001;

async function seedProgram(overrides: { active?: boolean } = {}) {
  const { data, error } = await supabaseAdmin
    .from("programs")
    .insert({
      title: "Сила Новичка",
      price: 5900,
      duration_weeks: 12,
      active: overrides.active ?? true,
      type: "template",
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("program seed failed");
  return data.id;
}

async function seedRequest({
  programId,
  status = "pending",
  consent = true,
  clientId = null,
  amount = 5900,
  paidAt = null,
  subType = "program",
  telegramId = TELEGRAM_ID,
}: {
  programId: string;
  status?: "pending" | "paid" | "cancelled";
  consent?: boolean;
  clientId?: string | null;
  amount?: number | null;
  paidAt?: string | null;
  subType?: "program" | "individ";
  telegramId?: number | null;
}) {
  const id = randomUUID();
  const { error } = await supabaseAdmin.from("purchase_requests").insert({
    id,
    order_id: id,
    program_id: programId,
    client_id: clientId,
    telegram_id: telegramId,
    name: "Иван Петров",
    contact: "@buyer",
    first_name: "Иван",
    last_name: "Петров",
    sub_type: subType,
    status,
    amount,
    consent_given: consent,
    paid_at: paidAt,
  });
  if (error) throw error;
  return id;
}

async function seedClient(
  programId: string,
  overrides: {
    accessStartDate?: string;
    accessEndDate?: string;
    telegramId?: number | null;
    connectCode?: string | null;
  } = {},
) {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .insert({
      name: "Иван Петров",
      telegram_id:
        overrides.telegramId === undefined ? TELEGRAM_ID : overrides.telegramId,
      timezone: "UTC",
      connect_code: overrides.connectCode ?? null,
      program_id: programId,
      access_start_date: overrides.accessStartDate ?? null,
      access_end_date: overrides.accessEndDate ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("client seed failed");
  return data.id;
}

type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
type MessageRow = Database["public"]["Tables"]["messages"]["Row"];
type PurchaseRequestRow = Database["public"]["Tables"]["purchase_requests"]["Row"];

async function clientRows(): Promise<ClientRow[]> {
  const { data, error } = await supabaseAdmin.from("clients").select("*");
  if (error) throw error;
  return data ?? [];
}

async function messageRows(): Promise<MessageRow[]> {
  const { data, error } = await supabaseAdmin.from("messages").select("*");
  if (error) throw error;
  return data ?? [];
}

async function requestRows(): Promise<PurchaseRequestRow[]> {
  const { data, error } = await supabaseAdmin
    .from("purchase_requests")
    .select("*");
  if (error) throw error;
  return data ?? [];
}

async function orderIdFor(requestId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("purchase_requests")
    .select("order_id")
    .eq("id", requestId)
    .single();
  if (error) throw error;
  if (!data?.order_id) throw new Error("order_id is missing");
  return data.order_id;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
  mocks.generateSchedule.mockResolvedValue({});
  mocks.sendTelegramMessage.mockResolvedValue(true);
});

describe("activatePurchaseByOrder on real data", () => {
  it("activates a pending request, creates one client and records instructions", async () => {
    const programId = await seedProgram();
    const requestId = await seedRequest({ programId });
    const orderId = await orderIdFor(requestId);

    const result = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });

    expect(result.error).toBeUndefined();
    expect(result.clientId).toBeTruthy();

    const clients = await clientRows();
    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({
      id: result.clientId,
      telegram_id: TELEGRAM_ID,
      program_id: programId,
      purchased_program_id: programId,
      payment_status: "paid",
      status: "active",
    });
    expect(new Date(clients[0].access_end_date as string).getTime()).toBeGreaterThan(
      Date.now(),
    );

    const requests = await requestRows();
    expect(requests[0]).toMatchObject({
      id: requestId,
      status: "paid",
      client_id: result.clientId,
    });
    expect(requests[0].paid_at).toBeTruthy();

    const messages = await messageRows();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      client_id: result.clientId,
      direction: "to_client",
    });

    expect(mocks.generateSchedule).toHaveBeenCalledWith(
      result.clientId,
      programId,
    );
    expect(mocks.sendTelegramMessage).toHaveBeenCalled();
  });

  it("reuses an existing client found by telegram_id", async () => {
    const programId = await seedProgram();
    const clientId = await seedClient(programId);
    const requestId = await seedRequest({ programId });
    const orderId = await orderIdFor(requestId);

    const result = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });

    expect(result.error).toBeUndefined();
    expect(result.clientId).toBe(clientId);
    expect(await clientRows()).toHaveLength(1);
    expect((await requestRows())[0].client_id).toBe(clientId);
  });

  it("does not write anything when the paid sum is below the request amount", async () => {
    const programId = await seedProgram();
    const requestId = await seedRequest({ programId });
    const orderId = await orderIdFor(requestId);

    const result = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5000,
    });

    expect(result.error).toBeTruthy();
    expect(await clientRows()).toHaveLength(0);
    expect((await requestRows())[0].status).toBe("pending");
    expect(await messageRows()).toHaveLength(0);
  });

  it("does not activate without consent", async () => {
    const programId = await seedProgram();
    const requestId = await seedRequest({ programId, consent: false });
    const orderId = await orderIdFor(requestId);

    const result = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });

    expect(result.error).toBeTruthy();
    expect(await clientRows()).toHaveLength(0);
    expect((await requestRows())[0]).toMatchObject({
      status: "pending",
      paid_at: null,
    });
    expect(await messageRows()).toHaveLength(0);
  });

  it("is idempotent after the client is fully activated", async () => {
    const programId = await seedProgram();
    const requestId = await seedRequest({ programId });
    const orderId = await orderIdFor(requestId);

    const first = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });
    expect(first.error).toBeUndefined();
    expect(first.clientId).toBeTruthy();

    const { error: scheduleError } = await supabaseAdmin
      .from("program_schedule")
      .insert({ client_id: first.clientId as string, week_number: 1 });
    if (scheduleError) throw scheduleError;

    const second = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });

    expect(second.error).toBeUndefined();
    expect(second.alreadyActivated).toBe(true);
    expect(second.clientId).toBe(first.clientId);
    expect(await clientRows()).toHaveLength(1);
    expect(await messageRows()).toHaveLength(1);
  });

  it("does not burn the cancelled-payment dedup key without a coach chat", async () => {
    vi.stubEnv("COACH_CHAT_ID", "");
    const programId = await seedProgram();
    const requestId = await seedRequest({ programId, status: "cancelled" });
    const orderId = await orderIdFor(requestId);

    const first = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });
    expect(first.alerted).toBe(false);
    expect(first.retryable).toBe(true);

    const { data: dedup } = await supabaseAdmin
      .from("bot_dedup")
      .select("key")
      .eq("key", `cancelled_payment:${orderId}`);
    expect(dedup).toHaveLength(0);

    vi.stubEnv("COACH_CHAT_ID", "42");
    mocks.sendTelegramMessage.mockResolvedValueOnce(true);
    const second = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });
    expect(second.alerted).toBe(true);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it("alerts the coach only once for a payment on a cancelled request", async () => {
    const programId = await seedProgram();
    const requestId = await seedRequest({ programId, status: "cancelled" });
    const orderId = await orderIdFor(requestId);

    const first = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });
    const second = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });

    expect(first.error).toBeTruthy();
    expect(second.error).toBeTruthy();
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(await clientRows()).toHaveLength(0);
  });

  it("retries a cancelled-payment alert that was not delivered", async () => {
    vi.stubEnv("COACH_CHAT_ID", "42");
    const programId = await seedProgram();
    const requestId = await seedRequest({ programId, status: "cancelled" });
    const orderId = await orderIdFor(requestId);
    mocks.sendTelegramMessage
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const first = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });
    expect(first.alerted).toBe(false);
    expect(first.retryable).toBe(true);

    const second = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });
    expect(second.alerted).toBe(true);
    expect(second.retryable).toBe(false);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(2);
    vi.unstubAllEnvs();
  });

  it("does not create duplicate clients when two webhooks race", async () => {
    const programId = await seedProgram();
    const requestId = await seedRequest({ programId });
    const orderId = await orderIdFor(requestId);

    const results = await Promise.all([
      activatePurchaseByOrder({
        orderId,
        coachId: null,
        paymentStatus: "success",
        paidSum: 5900,
      }),
      activatePurchaseByOrder({
        orderId,
        coachId: null,
        paymentStatus: "success",
        paidSum: 5900,
      }),
    ]);

    expect(results.some((result) => result.clientId)).toBe(true);
    const clients = await clientRows();
    expect(clients).toHaveLength(1);
    const requests = await requestRows();
    expect(requests[0]).toMatchObject({
      status: "paid",
      client_id: clients[0].id,
    });
    expect(await messageRows()).toHaveLength(1);
  });

  it("does not activate when the payment status is not success", async () => {
    const programId = await seedProgram();
    const requestId = await seedRequest({ programId });
    const orderId = await orderIdFor(requestId);

    const result = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "fail",
      paidSum: 5900,
    });

    expect(result.error).toBeTruthy();
    expect(await clientRows()).toHaveLength(0);
    expect((await requestRows())[0].status).toBe("pending");
    expect(await messageRows()).toHaveLength(0);
  });

  it("supports manual activation without a payment status", async () => {
    const programId = await seedProgram();
    const requestId = await seedRequest({ programId });
    const orderId = await orderIdFor(requestId);

    const result = await activatePurchaseByOrder({
      orderId,
      coachId: null,
    });

    expect(result.error).toBeUndefined();
    expect(result.clientId).toBeTruthy();
    expect(await clientRows()).toHaveLength(1);
    expect((await requestRows())[0].status).toBe("paid");
  });

  it("rejects an invalid order id", async () => {
    const result = await activatePurchaseByOrder({
      orderId: "not-a-uuid",
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });

    expect(result.error).toBeTruthy();
    expect(await clientRows()).toHaveLength(0);
  });

  it("rejects an unsupported request type", async () => {
    const programId = await seedProgram();
    const requestId = await seedRequest({ programId, subType: "individ" });
    const orderId = await orderIdFor(requestId);

    const result = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });

    expect(result.error).toBeTruthy();
    expect(await clientRows()).toHaveLength(0);
    expect((await requestRows())[0]).toMatchObject({
      status: "pending",
      paid_at: null,
    });
    expect(await messageRows()).toHaveLength(0);
  });

  it("does not activate an inactive program", async () => {
    const programId = await seedProgram({ active: false });
    const requestId = await seedRequest({ programId });
    const orderId = await orderIdFor(requestId);

    const result = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });

    expect(result.error).toBeTruthy();
    expect(await clientRows()).toHaveLength(0);
    expect((await requestRows())[0]).toMatchObject({
      status: "pending",
      paid_at: null,
    });
    expect(await messageRows()).toHaveLength(0);
  });

  it("keeps the access dates of an already active identical program", async () => {
    const programId = await seedProgram();
    const accessStartDate = "2026-01-01T00:00:00.000Z";
    const accessEndDate = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const clientId = await seedClient(programId, {
      accessStartDate,
      accessEndDate,
    });
    const requestId = await seedRequest({ programId });
    const orderId = await orderIdFor(requestId);

    const result = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });

    expect(result.error).toBeUndefined();
    expect(result.clientId).toBe(clientId);
    const client = (await clientRows())[0];
    expect(new Date(client.access_start_date as string).getTime()).toBe(
      new Date(accessStartDate).getTime(),
    );
    expect(new Date(client.access_end_date as string).getTime()).toBe(
      new Date(accessEndDate).getTime(),
    );
    const expectedDate = new Intl.DateTimeFormat("ru-RU", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).format(new Date(accessEndDate));
    expect((await messageRows())[0].text).toContain(expectedDate);
  });

  it("generates a connect code when the buyer has no Telegram", async () => {
    const programId = await seedProgram();
    const requestId = await seedRequest({
      programId,
      telegramId: null,
    });
    const orderId = await orderIdFor(requestId);

    const result = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });

    expect(result.error).toBeUndefined();
    expect(result.clientId).toBeTruthy();
    expect(result.connectCode).toBeTruthy();
    const client = (await clientRows())[0];
    expect(client.telegram_id).toBeNull();
    expect(client.connect_code).toBe(result.connectCode);
  });

  it("reports a Telegram mismatch before claiming an already activated client", async () => {
    const programId = await seedProgram();
    const requestId = await seedRequest({ programId });
    const orderId = await orderIdFor(requestId);
    const first = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });
    expect(first.error).toBeUndefined();
    const { error: scheduleError } = await supabaseAdmin
      .from("program_schedule")
      .insert({ client_id: first.clientId as string, week_number: 1 });
    if (scheduleError) throw scheduleError;
    const { error: updateError } = await supabaseAdmin
      .from("purchase_requests")
      .update({ telegram_id: 999999 })
      .eq("id", requestId);
    if (updateError) throw updateError;

    const retry = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });
    expect(retry.error).toContain("не совпадают");
    expect(retry.alreadyActivated).toBeUndefined();
  });

  it("rejects a Telegram id that does not match the linked client", async () => {
    const programId = await seedProgram();
    const clientId = await seedClient(programId, { telegramId: 555555 });
    const requestId = await seedRequest({ programId, clientId });
    const orderId = await orderIdFor(requestId);

    const result = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });

    expect(result.error).toBeTruthy();
    const client = (await clientRows())[0];
    expect(client.telegram_id).toBe(555555);
    expect(client.payment_status).not.toBe("paid");
    const request = (await requestRows())[0];
    // Платёж получен: клейм не откатываем, иначе вебхук будет ретраить
    // заведомо неверную привязку. Заявку разбирает тренер.
    expect(request.status).toBe("paid");
    expect(request.paid_at).toBeTruthy();
    expect(await messageRows()).toHaveLength(0);

    const retry = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });
    expect(retry.error).toBeTruthy();
    expect((await requestRows())[0].status).toBe("paid");
  });

  it("removes undelivered instructions so a stale recovery can resend them", async () => {
    const programId = await seedProgram();
    const requestId = await seedRequest({ programId });
    const orderId = await orderIdFor(requestId);
    mocks.sendTelegramMessage
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);

    const first = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });
    expect(first.warning).toBeTruthy();
    expect(await messageRows()).toHaveLength(0);

    const stale = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const { error: staleError } = await supabaseAdmin
      .from("purchase_requests")
      .update({ paid_at: stale })
      .eq("id", requestId);
    if (staleError) throw staleError;

    const retry = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });
    expect(retry.warning).toBeUndefined();
    expect(await messageRows()).toHaveLength(1);
  });

  it("reports a schedule generation failure but keeps the assigned program", async () => {
    const programId = await seedProgram();
    const requestId = await seedRequest({ programId });
    const orderId = await orderIdFor(requestId);
    mocks.generateSchedule.mockResolvedValueOnce({ error: "boom" });

    const result = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });

    expect(result.error).toBeTruthy();
    expect(result.programAssigned).toBe(true);
    const client = (await clientRows())[0];
    expect(client.program_id).toBe(programId);
    expect(client.payment_status).toBe("paid");
  });

  it("takes over a stale paid request and activates its linked client", async () => {
    const programId = await seedProgram();
    const clientId = await seedClient(programId, { telegramId: 555555 });
    const requestId = await seedRequest({
      programId,
      status: "paid",
      clientId,
      telegramId: 555555,
      paidAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    });
    const orderId = await orderIdFor(requestId);

    const result = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });

    expect(result.error).toBeUndefined();
    expect(result.clientId).toBe(clientId);
    const client = (await clientRows())[0];
    expect(client.payment_status).toBe("paid");
    expect(client.access_end_date).toBeTruthy();
    expect(await messageRows()).toHaveLength(1);
  });

  it("refuses to recover a paid request into a mismatched Telegram client", async () => {
    const programId = await seedProgram();
    const clientId = await seedClient(programId, { telegramId: 555555 });
    const requestId = await seedRequest({
      programId,
      status: "paid",
      clientId,
      paidAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    });
    const orderId = await orderIdFor(requestId);

    const result = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });

    expect(result.error).toBeTruthy();
    const client = (await clientRows())[0];
    expect(client.payment_status).not.toBe("paid");
    expect(await messageRows()).toHaveLength(0);
    expect((await requestRows())[0].status).toBe("paid");
  });

  it("reports in-progress when another invocation just claimed the request", async () => {
    const programId = await seedProgram();
    const clientId = await seedClient(programId);
    const requestId = await seedRequest({
      programId,
      status: "paid",
      clientId,
      paidAt: new Date().toISOString(),
    });
    const orderId = await orderIdFor(requestId);

    const result = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });

    expect(result.error).toBeTruthy();
    expect(result.alreadyActivated).toBeUndefined();
    const client = (await clientRows())[0];
    expect(client.payment_status).not.toBe("paid");
    expect(await messageRows()).toHaveLength(0);
  });

  it("reuses an existing connect code for a client without Telegram", async () => {
    const programId = await seedProgram();
    const clientId = await seedClient(programId, {
      telegramId: null,
      connectCode: "ABCD1234",
    });
    const requestId = await seedRequest({
      programId,
      clientId,
      telegramId: null,
    });
    const orderId = await orderIdFor(requestId);

    const result = await activatePurchaseByOrder({
      orderId,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });

    expect(result.error).toBeUndefined();
    expect(result.connectCode).toBe("ABCD1234");
    const client = (await clientRows())[0];
    expect(client.connect_code).toBe("ABCD1234");
  });

});
