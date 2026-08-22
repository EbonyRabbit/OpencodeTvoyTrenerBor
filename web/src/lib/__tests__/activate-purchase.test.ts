import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("@/lib/telegram", () => ({
  sendTelegramMessage: vi.fn(),
}));

vi.mock("@/lib/plan-adjustment", () => ({
  generateSchedule: vi.fn(),
}));

import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendTelegramMessage } from "@/lib/telegram";
import { generateSchedule } from "@/lib/plan-adjustment";
import {
  activatePurchaseByOrder,
  applyProgramActivation,
  buildActivationCoachMessage,
  toFiniteNumber,
} from "@/lib/activate-purchase";

const ORDER_ID = "c3f0a2bc-1111-4990-8a58-6a0c8a4f2b01";
const REQUEST_ID = "99999999-8888-7777-6666-555555555555";
const PROGRAM_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const CLIENT_ID = "11111111-2222-3333-4444-555555555555";
const COACH_ID = "22222222-2222-2222-2222-222222222222";
const NOW = "2026-08-20T10:00:00.000Z";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const TG_ID = 777;

type ChainRes = {
  data?: unknown;
  error?: { message: string; code?: string } | null;
};

const payloads = {
  update: {} as Record<string, unknown[]>,
  insert: {} as Record<string, unknown[]>,
  delete: {} as Record<string, unknown[]>,
};

function record(
  bucket: Record<string, unknown[]>,
  table: string,
  payload: unknown,
) {
  (bucket[table] ??= []).push(payload);
}

function mockDb(calls: Array<() => Promise<ChainRes>>) {
  const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  fake.from.mockReset();
  let idx = 0;
  fake.from.mockImplementation((table: string) => {
    const link = {
      select: () => link,
      eq: () => link,
      is: () => link,
      lt: () => link,
      or: () => link,
      gte: () => link,
      limit: () => link,
      update: (payload?: unknown) => {
        if (payload !== undefined) record(payloads.update, table, payload);
        return link;
      },
      delete: () => link,
      insert: (payload?: unknown) => {
        if (payload !== undefined) record(payloads.insert, table, payload);
        return link;
      },
      maybeSingle: () => {
        const step = calls[idx++];
        if (!step) return Promise.resolve({ data: null, error: null });
        return step();
      },
      then: (onFulfilled: (v: ChainRes) => unknown) => {
        const step = calls[idx++];
        if (!step)
          return Promise.resolve({ data: null, error: null }).then(onFulfilled);
        return Promise.resolve(step()).then(onFulfilled);
      },
    };
    return link;
  });
}

const pendingRequest = {
  id: REQUEST_ID,
  status: "pending",
  sub_type: "program",
  program_id: PROGRAM_ID,
  amount: 5900,
  name: "Иван Петров",
  contact: "+79001234567",
  telegram_id: null,
  first_name: "Иван",
  last_name: "Петров",
  consent_given: true,
  consent_at: "2026-08-18T10:00:00.000Z",
  consent_version: "2026-08-01",
  client_id: null,
};

const baseProgram = {
  id: PROGRAM_ID,
  title: "Сила 12 недель",
  price: 5900,
  duration_weeks: 12,
};

const existingClient = {
  id: CLIENT_ID,
  name: "Иван",
  language: "ru",
  telegram_id: TG_ID,
  connect_code: null,
  timezone: "Europe/Moscow",
};

function ok(data: unknown): Promise<ChainRes> {
  return Promise.resolve({ data, error: null });
}

function err(message: string, code?: string): Promise<ChainRes> {
  return Promise.resolve({ data: null, error: { message, code } });
}

/** [request, program, claim, client-resolve?, link-CAS, update, sched, pauses, connect?, messages] */
function fullFlow(
  resolve: Array<() => Promise<ChainRes>>,
  opts: { request?: Record<string, unknown>; withConnectCode?: boolean } = {},
): Array<() => Promise<ChainRes>> {
  return [
    () =>
      ok(
        opts.request ? { ...pendingRequest, ...opts.request } : pendingRequest,
      ),
    () => ok(baseProgram),
    () => ok({ id: REQUEST_ID }), // claim
    ...resolve,
    () => ok({ id: REQUEST_ID }), // link CAS (client_id set)
    () => ok({ error: null, data: null }), // clients update
    () => ok({ error: null, data: null }), // program_schedule delete
    () => ok({ error: null, data: null }), // plan_pauses delete
    ...(opts.withConnectCode ? [() => ok({ error: null, data: null })] : []), // connect-code update
    () => ok({ error: null, data: null }), // messages insert
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.COACH_CHAT_ID;
  delete process.env.TELEGRAM_BOT_USERNAME;
  for (const bucket of Object.values(payloads)) {
    for (const key of Object.keys(bucket)) delete bucket[key];
  }
  (
    sendTelegramMessage as unknown as ReturnType<typeof vi.fn>
  ).mockResolvedValue(true);
  (generateSchedule as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    error: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("activatePurchaseByOrder: argument checks", () => {
  it("rejects a non-UUID order id", async () => {
    mockDb([]);

    const result = await activatePurchaseByOrder({
      orderId: "not-a-uuid",
      coachId: COACH_ID,
    });
    expect(result.error).toBe("Некорректный заказ.");
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("rejects when the request is not found", async () => {
    mockDb([() => ok(null)]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toBe("Заявка не найдена.");
  });

  it("rejects a cancelled request", async () => {
    mockDb([() => ok({ ...pendingRequest, status: "cancelled" })]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toBe("Заявка отменена.");
  });

  it("rejects a non-program request", async () => {
    mockDb([() => ok({ ...pendingRequest, sub_type: "individ" })]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toBe("Неподдерживаемый тип заявки.");
  });

  it("rejects when the program is missing or inactive", async () => {
    mockDb([() => ok(pendingRequest), () => ok(null)]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toBe("Программа недоступна для активации.");
  });

  it("rejects a request without consent before any write", async () => {
    mockDb([() => ok({ ...pendingRequest, consent_given: false })]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toBe("Не подтверждено согласие на обработку данных.");
    expect(payloads.update.purchase_requests).toBeUndefined();
    expect(payloads.insert.clients).toBeUndefined();
  });
});

describe("activatePurchaseByOrder: payment verification", () => {
  it("rejects a non-success payment status before any write", async () => {
    mockDb([() => ok(pendingRequest), () => ok(baseProgram)]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
      paymentStatus: "failed",
    });
    expect(result.error).toBe("Платёж не подтверждён.");
    expect(payloads.update.purchase_requests).toBeUndefined();
    expect(payloads.insert.clients).toBeUndefined();
  });

  it("rejects a paid sum below the expected amount", async () => {
    mockDb([() => ok(pendingRequest), () => ok(baseProgram)]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
      paymentStatus: "success",
      paidSum: 5000,
    });
    expect(result.error).toBe("Сумма оплаты не совпадает с ожидаемой.");
    expect(payloads.update.purchase_requests).toBeUndefined();
    expect(payloads.insert.clients).toBeUndefined();
  });

  it("refuses to verify when neither request amount nor program price is usable", async () => {
    mockDb([
      () => ok({ ...pendingRequest, amount: null }),
      () => ok({ ...baseProgram, price: null }),
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
      paymentStatus: "success",
      paidSum: 1,
    });
    expect(result.error).toBe("Не удалось проверить сумму оплаты.");
    expect(payloads.update.purchase_requests).toBeUndefined();
    expect(payloads.insert.clients).toBeUndefined();
  });

  it("activates when the paid sum matches the request amount", async () => {
    mockDb([
      ...fullFlow([() => ok(existingClient)], { withConnectCode: true }),
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
      paymentStatus: "success",
      paidSum: 5900,
    });
    expect(result.error).toBeUndefined();
    expect(result.clientId).toBe(CLIENT_ID);
  });

  it("activates without payment verification when the caller is manual (markPurchased)", async () => {
    mockDb([
      ...fullFlow([() => ok(existingClient)], { withConnectCode: true }),
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toBeUndefined();
    expect(result.clientId).toBe(CLIENT_ID);
  });
});

describe("activatePurchaseByOrder: idempotency for paid requests", () => {
  it("returns alreadyActivated when the client is fully activated with a schedule", async () => {
    mockDb([
      () => ok({ ...pendingRequest, status: "paid", client_id: CLIENT_ID }),
      () => ok(baseProgram),
      () => ok(null), // claim loses the race
      () => ok({ ...pendingRequest, status: "paid", client_id: CLIENT_ID }), // re-read
      () => ok(existingClient), // load linked client
      () =>
        ok({
          payment_status: "paid",
          program_id: PROGRAM_ID,
          access_end_date: "2026-11-12T10:00:00.000Z",
        }), // activation completeness check
      () => ok({ id: "sched-1" }), // schedule exists
      () => ok({ id: "msg-1" }), // instructions message exists
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.alreadyActivated).toBe(true);
    expect(result.requestId).toBe(REQUEST_ID);
    expect(result.clientId).toBe(CLIENT_ID);
    expect(payloads.update.clients).toBeUndefined();
    expect(payloads.insert.clients).toBeUndefined();
    expect(payloads.update.purchase_requests).toHaveLength(1); // only the failed claim
  });

  it("resumes activation when the paid request was never fully activated", async () => {
    mockDb([
      () => ok({ ...pendingRequest, status: "paid", client_id: CLIENT_ID }),
      () => ok(baseProgram),
      () => ok(null), // claim loses the race
      () => ok({ ...pendingRequest, status: "paid", client_id: CLIENT_ID }), // re-read
      () => ok(existingClient), // load linked client
      () =>
        ok({
          payment_status: "pending",
          program_id: null,
          access_end_date: null,
        }), // completeness check: NOT activated
      () => ok({ id: REQUEST_ID }), // stale-link takeover succeeds
      () => ok({ error: null, data: null }), // clients update
      () => ok({ error: null, data: null }), // program_schedule delete
      () => ok({ error: null, data: null }), // plan_pauses delete
      () => ok({ error: null, data: null }), // messages insert
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toBeUndefined();
    expect(result.alreadyActivated).toBeUndefined();
    expect(result.clientId).toBe(CLIENT_ID);
    expect(payloads.update.clients).toHaveLength(1);
    const claimUpdates = (payloads.update.purchase_requests ?? []).map(
      (p) => p as Record<string, unknown>,
    );
    expect(claimUpdates.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(claimUpdates.filter((p) => p.paid_at)).toHaveLength(2); // claim + stale takeover
  });

  it("takes over when the client is activated with a schedule but instructions were never delivered", async () => {
    vi.setSystemTime(new Date(NOW));
    mockDb([
      () => ok(pendingRequest),
      () => ok(baseProgram),
      () => ok({ id: REQUEST_ID }), // claim
      () => ok(existingClient), // resolve
      () => ok(null), // link CAS loses the race
      () => ok({ client_id: CLIENT_ID, paid_at: "2026-08-20T09:00:00.000Z" }), // re-read linked client_id
      () =>
        ok({
          ...existingClient,
          program_id: PROGRAM_ID,
          access_end_date: "2026-11-12T10:00:00.000Z",
        }), // load linked client
      () =>
        ok({
          payment_status: "paid",
          program_id: PROGRAM_ID,
          access_end_date: "2026-11-12T10:00:00.000Z",
        }), // client activated
      () => ok({ id: "sched-1" }), // schedule exists...
      () => ok(null), // ...but no instructions message since paid_at
      () => ok({ id: REQUEST_ID }), // stale-link takeover succeeds
      () => ok({ error: null, data: null }), // clients update (dates preserved)
      () => ok({ error: null, data: null }), // program_schedule delete
      () => ok({ error: null, data: null }), // plan_pauses delete
      () => ok({ error: null, data: null }), // messages insert (delivery retried)
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toBeUndefined();
    expect(result.alreadyActivated).toBeUndefined();
    expect(payloads.update.clients).toHaveLength(1);
  });

  it("unlinks the request and reports in-progress when the linked client was deleted", async () => {
    mockDb([
      () => ok(pendingRequest),
      () => ok(baseProgram),
      () => ok(null), // claim loses the race
      () => ok({ ...pendingRequest, status: "paid", client_id: CLIENT_ID }), // re-read
      () => ok(null), // load linked client -> gone (deleted)
      () => ok({ error: null, data: null }), // unlink update (client_id = null)
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toContain("уже выполняется");
    const unlinkUpdate = payloads.update.purchase_requests?.find(
      (p) =>
        (p as Record<string, unknown>).client_id === null &&
        (p as Record<string, unknown>).status === undefined,
    ) as Record<string, unknown> | undefined;
    expect(unlinkUpdate).toBeDefined();
    expect(payloads.insert.clients).toBeUndefined();
  });
});

describe("activatePurchaseByOrder: client resolution", () => {
  it("creates a new client from request data and activates", async () => {
    // telegram_id is null, so the telegram lookup is skipped and the client is created
    mockDb([
      ...fullFlow([() => ok({ id: CLIENT_ID })], { withConnectCode: true }), // insert + connect code
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });

    expect(result.error).toBeUndefined();
    expect(result.clientId).toBe(CLIENT_ID);
    expect(result.requestId).toBe(REQUEST_ID);
    expect(result.connectCode).toMatch(/^[A-F0-9]{8}$/);
    expect(result.warning).toContain("не подключён к Telegram");

    const insert = payloads.insert.clients?.[0] as Record<string, unknown>;
    expect(insert.name).toBe("Иван Петров");
    expect(insert.language).toBe("ru");
    expect(insert.timezone).toBe("UTC");
    expect(insert.telegram_id).toBeNull();
    expect(insert.status).toBe("active");
    expect(insert.payment_status).toBe("paid");
    expect(insert.program_id).toBe(PROGRAM_ID);
    expect(insert.purchased_program_id).toBe(PROGRAM_ID);
    expect(insert.client_consent_given).toBe(true);
    expect(insert.client_consent_given_at).toBe(pendingRequest.consent_at);
    expect(insert.client_consent_version).toBe(pendingRequest.consent_version);
    expect(insert.consent_given).toBe(true);
    expect(insert.consent_given_at).toBe(pendingRequest.consent_at);

    const claim = payloads.update.purchase_requests?.[0] as Record<
      string,
      unknown
    >;
    expect(claim.status).toBe("paid");
    expect(claim.paid_at).toBeTruthy();
    expect(claim.client_id).toBeUndefined(); // claim happens BEFORE client creation

    const link = payloads.update.purchase_requests?.find(
      (p) => (p as Record<string, unknown>).client_id === CLIENT_ID,
    ) as Record<string, unknown>;
    expect(link.client_id).toBe(CLIENT_ID);

    expect(sendTelegramMessage).toHaveBeenCalledTimes(0);
  });

  it("reuses an existing client found by telegram_id and skips creation", async () => {
    mockDb([
      ...fullFlow(
        [
          () => ok(existingClient), // telegram lookup hit
        ],
        { request: { telegram_id: TG_ID } },
      ),
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toBeUndefined();
    expect(result.clientId).toBe(CLIENT_ID);
    expect(payloads.insert.clients).toBeUndefined();
    expect(result.connectCode).toBeUndefined();

    const clientUpdate = payloads.update.clients?.[0] as Record<
      string,
      unknown
    >;
    expect(clientUpdate.status).toBe("active");
    expect(clientUpdate.payment_status).toBe("paid");
    expect(clientUpdate.program_id).toBe(PROGRAM_ID);
    const end = new Date(clientUpdate.access_end_date as string).getTime();
    const start = new Date(clientUpdate.access_start_date as string).getTime();
    expect(end - start).toBe(12 * WEEK_MS);

    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      TG_ID,
      expect.stringContaining("Привет, Иван!"),
    );
  });

  it("resolves the client by client_id when present", async () => {
    mockDb([
      ...fullFlow([() => ok(existingClient)], {
        request: { client_id: CLIENT_ID },
      }), // id lookup
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toBeUndefined();
    expect(result.clientId).toBe(CLIENT_ID);
    expect(payloads.insert.clients).toBeUndefined();
    const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    const clientsCalls = fake.from.mock.calls.filter((c) => c[0] === "clients");
    expect(clientsCalls).toHaveLength(2); // id lookup + activation update
  });

  it("rejects when the resolved client's telegram_id does not match the request", async () => {
    mockDb([
      () => ok({ ...pendingRequest, client_id: CLIENT_ID, telegram_id: 999 }),
      () => ok(baseProgram),
      () => ok({ id: REQUEST_ID }), // claim
      () => ok(existingClient), // id lookup -> telegram_id is TG_ID (777), not 999
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toContain("не совпадают");
    expect(result.requestId).toBe(REQUEST_ID);
    expect(payloads.update.clients).toBeUndefined();
    expect(payloads.insert.clients).toBeUndefined();
  });

  it("retries by telegram_id when client creation hits a 23505 race", async () => {
    mockDb([
      ...fullFlow(
        [
          () => ok(null), // telegram lookup miss
          () => err("duplicate", "23505"), // insert fails
          () => ok(existingClient), // retry lookup by telegram_id
        ],
        { request: { telegram_id: TG_ID } },
      ),
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toBeUndefined();
    expect(result.clientId).toBe(CLIENT_ID);
    expect(sendTelegramMessage).toHaveBeenCalledWith(TG_ID, expect.any(String));
  });

  it("falls back to the raw name when first/last names are absent", async () => {
    mockDb([
      ...fullFlow([() => ok({ id: CLIENT_ID })], { withConnectCode: true }),
    ]);
    const req = { ...pendingRequest, first_name: null, last_name: null };
    const queue = mockDb;
    const calls = [
      () => ok(req),
      () => ok(baseProgram),
      () => ok({ id: REQUEST_ID }),
      () => ok({ id: CLIENT_ID }),
      () => ok({ error: null, data: null }),
      () => ok({ error: null, data: null }),
      () => ok({ error: null, data: null }),
      () => ok({ error: null, data: null }),
      () => ok({ error: null, data: null }),
      () => ok({ error: null, data: null }),
      () => ok({ error: null, data: null }),
    ];
    queue(calls);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toBeUndefined();
    const insert = payloads.insert.clients?.[0] as Record<string, unknown>;
    expect(insert.name).toBe("Иван Петров");
  });
});

describe("activatePurchaseByOrder: reactivation of expired clients", () => {
  it("re-activates an access_expired client with fresh access dates", async () => {
    vi.setSystemTime(new Date(NOW));
    mockDb([
      ...fullFlow([() => ok(existingClient)], {
        request: { client_id: CLIENT_ID },
      }),
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });

    expect(result.error).toBeUndefined();
    const clientUpdate = payloads.update.clients?.[0] as Record<
      string,
      unknown
    >;
    expect(clientUpdate.status).toBe("active");
    expect(clientUpdate.access_start_date).toBe(NOW);
    expect(clientUpdate.access_end_date).toBe(
      new Date(new Date(NOW).getTime() + 12 * WEEK_MS).toISOString(),
    );
  });
});

describe("activatePurchaseByOrder: claim, rollback, idempotency", () => {
  it("reports alreadyActivated when the claim loses a race but the client is activated", async () => {
    mockDb([
      () => ok(pendingRequest),
      () => ok(baseProgram),
      () => ok(null), // claim update -> no row
      () => ok({ ...pendingRequest, status: "paid", client_id: CLIENT_ID }), // re-read
      () => ok(existingClient), // load linked client
      () =>
        ok({
          payment_status: "paid",
          program_id: PROGRAM_ID,
          access_end_date: "2026-11-12T10:00:00.000Z",
        }),
      () => ok({ id: "sched-1" }), // schedule exists
      () => ok({ id: "msg-1" }), // instructions message exists
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.alreadyActivated).toBe(true);
    expect(result.clientId).toBe(CLIENT_ID);
    expect(payloads.insert.clients).toBeUndefined();
    expect(payloads.update.clients).toBeUndefined();
  });

  it("returns an error when the claim is lost but the request is not paid", async () => {
    mockDb([
      () => ok(pendingRequest),
      () => ok(baseProgram),
      () => ok(null), // claim update -> no row
      () => ok({ ...pendingRequest, status: "pending" }), // re-read
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toBe("Заявка уже была обработана.");
    expect(result.requestId).toBe(REQUEST_ID);
    expect(payloads.insert.clients).toBeUndefined();
  });

  it("keeps the claim paid and keeps the created client when activation fails", async () => {
    (generateSchedule as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        error: "план не создался",
      },
    );
    mockDb([
      () => ok(pendingRequest),
      () => ok(baseProgram),
      () => ok({ id: REQUEST_ID }), // claim
      () => ok({ id: CLIENT_ID }), // insert -> created client
      () => ok({ id: REQUEST_ID }), // link CAS
      () => ok({ error: null, data: null }), // clients update
      () => ok({ error: null, data: null }), // program_schedule delete
      () => ok({ error: null, data: null }), // plan_pauses delete
      // generateSchedule fails -> no messages
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toContain("расписание");
    expect(result.requestId).toBe(REQUEST_ID);
    expect(result.clientId).toBe(CLIENT_ID);
    expect(
      payloads.update.purchase_requests?.some(
        (p) => (p as Record<string, unknown>).status === "pending",
      ),
    ).toBe(false);
    expect(payloads.insert.clients).toHaveLength(1);
    expect(payloads.delete.clients ?? []).toHaveLength(0);
  });

  it("returns an error when the claim itself fails", async () => {
    mockDb([
      () => ok(pendingRequest),
      () => ok(baseProgram),
      () => err("boom"),
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toBe("Ошибка обновления статуса заказа.");
    expect(payloads.update.clients).toBeUndefined();
    expect(payloads.insert.clients).toBeUndefined();
  });

  it("keeps the claim paid when activation fails for a pre-existing client", async () => {
    (generateSchedule as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        error: "план не создался",
      },
    );
    mockDb([
      () => ok(pendingRequest),
      () => ok(baseProgram),
      () => ok({ id: REQUEST_ID }), // claim
      () => ok(existingClient), // resolve existing client
      () => ok({ id: REQUEST_ID }), // link CAS
      () => ok({ error: null, data: null }), // clients update
      () => ok({ error: null, data: null }), // program_schedule delete
      () => ok({ error: null, data: null }), // plan_pauses delete
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toContain("расписание");
    expect(payloads.delete.clients ?? []).toHaveLength(0);
    expect(
      payloads.update.purchase_requests?.some(
        (p) => (p as Record<string, unknown>).status === "pending",
      ),
    ).toBe(false);
  });

  it("reports in-progress when the link loses a race and the client is not yet activated", async () => {
    mockDb([
      () => ok(pendingRequest),
      () => ok(baseProgram),
      () => ok({ id: REQUEST_ID }), // claim
      () => ok(existingClient), // resolve
      () => ok(null), // link CAS loses the race
      () => ok({ client_id: CLIENT_ID }), // re-read linked client_id
      () => ok(existingClient), // load linked client
      () =>
        ok({
          payment_status: "pending",
          program_id: null,
          access_end_date: null,
        }), // completeness check: NOT activated yet
      () => ok(null), // stale-link takeover fails (fresh paid_at)
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toContain("уже выполняется");
    expect(result.clientId).toBe(CLIENT_ID);
    expect(payloads.update.clients).toBeUndefined();
  });

  it("reports alreadyActivated when the link loses a race and the client is activated", async () => {
    mockDb([
      () => ok(pendingRequest),
      () => ok(baseProgram),
      () => ok({ id: REQUEST_ID }), // claim
      () => ok(existingClient), // resolve
      () => ok(null), // link CAS loses the race
      () => ok({ client_id: CLIENT_ID }), // re-read linked client_id
      () => ok(existingClient), // load linked client
      () =>
        ok({
          payment_status: "paid",
          program_id: PROGRAM_ID,
          access_end_date: "2026-11-12T10:00:00.000Z",
        }), // completeness check: already activated
      () => ok({ id: "sched-1" }), // schedule exists
      () => ok({ id: "msg-1" }), // instructions message exists
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.alreadyActivated).toBe(true);
    expect(result.clientId).toBe(CLIENT_ID);
    expect(payloads.update.clients).toBeUndefined();
  });

  it("renews a stale linked activation by takeover when the client is incomplete", async () => {
    vi.setSystemTime(new Date(NOW));
    mockDb([
      () => ok(pendingRequest),
      () => ok(baseProgram),
      () => ok({ id: REQUEST_ID }), // claim
      () => ok(existingClient), // resolve
      () => ok(null), // link CAS loses the race
      () => ok({ client_id: CLIENT_ID }), // re-read linked client_id
      () =>
        ok({
          ...existingClient,
          program_id: PROGRAM_ID,
          access_end_date: "2026-11-12T10:00:00.000Z",
        }), // load linked client (same active program)
      () =>
        ok({
          payment_status: "paid",
          program_id: PROGRAM_ID,
          access_end_date: "2026-11-12T10:00:00.000Z",
        }), // client activated...
      () => ok(null), // ...but schedule is missing
      () => ok({ id: REQUEST_ID }), // stale-link takeover succeeds (paid_at older than 10 min)
      () => ok({ error: null, data: null }), // clients update (dates preserved)
      () => ok({ error: null, data: null }), // program_schedule delete
      () => ok({ error: null, data: null }), // plan_pauses delete
      () => ok({ error: null, data: null }), // messages insert
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toBeUndefined();
    expect(result.alreadyActivated).toBeUndefined();
    expect(result.clientId).toBe(CLIENT_ID);
    expect(payloads.update.clients).toHaveLength(1);
    const clientUpdate = payloads.update.clients?.[0] as Record<
      string,
      unknown
    >;
    expect(clientUpdate.access_start_date).toBeUndefined(); // same active program: dates preserved
    expect(clientUpdate.purchase_date).toBeUndefined(); // original purchase date kept
  });

  it("takes over a legacy paid request with null paid_at when activation is incomplete", async () => {
    vi.setSystemTime(new Date(NOW));
    mockDb([
      () => ok({ ...pendingRequest, status: "paid", client_id: CLIENT_ID }), // initial read
      () => ok(baseProgram),
      () => ok(null), // claim CAS misses (already paid)
      () =>
        ok({ status: "paid", client_id: CLIENT_ID, paid_at: null }), // re-read: legacy row without paid_at
      () =>
        ok({
          ...existingClient,
          program_id: null,
          access_end_date: null,
        }), // load linked client (not activated)
      () =>
        ok({
          payment_status: "paid",
          program_id: PROGRAM_ID,
          access_end_date: "2026-11-12T10:00:00.000Z",
        }), // client activated...
      () => ok(null), // ...but schedule is missing -> falls to takeover
      () => ok({ id: REQUEST_ID }), // takeover matches paid_at IS NULL
      () => ok({ error: null, data: null }), // clients update
      () => ok({ error: null, data: null }), // program_schedule delete
      () => ok({ error: null, data: null }), // plan_pauses delete
      () => ok({ error: null, data: null }), // messages insert
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toBeUndefined();
    expect(result.alreadyActivated).toBeUndefined();
    expect(result.clientId).toBe(CLIENT_ID);
    const clientUpdate = payloads.update.clients?.[0] as Record<
      string,
      unknown
    >;
    expect(clientUpdate.access_start_date).toBeDefined(); // not same active program: fresh dates
    expect(clientUpdate.purchase_date).toBeDefined();
  });
});

describe("activatePurchaseByOrder: connect code for clients without telegram", () => {
  it("generates and returns a connect code when the client has no telegram_id and no code", async () => {
    mockDb([
      ...fullFlow(
        [
          () =>
            ok({ ...existingClient, telegram_id: null, connect_code: null }),
        ],
        { request: { client_id: CLIENT_ID }, withConnectCode: true }, // id lookup + connect code
      ),
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toBeUndefined();
    expect(result.connectCode).toMatch(/^[A-F0-9]{8}$/);
    expect(result.warning).toContain("не подключён к Telegram");
    const connectPayload = payloads.update.clients?.find(
      (p) => (p as Record<string, unknown>).connect_code,
    );
    expect((connectPayload as Record<string, unknown>).connect_code).toBe(
      result.connectCode,
    );
  });

  it("reuses an existing connect code instead of generating a new one", async () => {
    mockDb([
      ...fullFlow(
        [
          () =>
            ok({
              ...existingClient,
              telegram_id: null,
              connect_code: "OLD12345",
            }),
        ],
        {
          request: { client_id: CLIENT_ID },
        },
      ),
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.connectCode).toBe("OLD12345");
    const codePayloads =
      payloads.update.clients?.filter(
        (p) => (p as Record<string, unknown>).connect_code,
      ) ?? [];
    expect(codePayloads).toHaveLength(0);
  });
});

describe("activatePurchaseByOrder: numeric values from PostgREST (numeric as string)", () => {
  it("normalizes string prices and amounts before building messages", async () => {
    process.env.COACH_CHAT_ID = "777000";
    mockDb([
      () => ok({ ...pendingRequest, amount: "7000.00", telegram_id: TG_ID }),
      () => ok({ ...baseProgram, price: "5900.00" }),
      () => ok({ id: REQUEST_ID }),
      () => ok(existingClient),
      () => ok({ error: null, data: null }), // clients update
      () => ok({ error: null, data: null }), // program_schedule delete
      () => ok({ error: null, data: null }), // plan_pauses delete
      () => ok({ error: null, data: null }), // messages insert
      () => ok({ error: null, data: null }), // link update
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toBeUndefined();
    const coachMessage = (
      sendTelegramMessage as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[1][1] as string;
    expect(coachMessage).toMatch(/Цена: 5\s*900 ₽/);
    expect(coachMessage).toMatch(/Сумма оплаты: 7\s*000 ₽/);
    // numeric-as-string must be treated as numbers, not text
    expect(coachMessage).not.toContain('"7000.00"');
    expect(coachMessage).not.toContain('"5900.00"');
  });

  it("drops invalid numeric values instead of crashing", async () => {
    process.env.COACH_CHAT_ID = "777000";
    mockDb([
      () => ok({ ...pendingRequest, amount: "abc", telegram_id: TG_ID }),
      () => ok({ ...baseProgram, price: "5900.00" }),
      () => ok({ id: REQUEST_ID }),
      () => ok(existingClient), // telegram lookup hit
      () => ok({ id: REQUEST_ID }), // link CAS
      () => ok({ error: null, data: null }),
      () => ok({ error: null, data: null }),
      () => ok({ error: null, data: null }),
      () => ok({ error: null, data: null }),
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toBeUndefined();
    expect(sendTelegramMessage).toHaveBeenCalledTimes(2);
    const coachMessage = (
      sendTelegramMessage as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[1][1] as string;
    expect(coachMessage).not.toMatch(/Сумма оплаты/);
    expect(coachMessage).toMatch(/Цена: 5\s*900 ₽/);
  });
});

describe("applyProgramActivation: coach notification", () => {
  it("notifies the coach with a full activation summary", async () => {
    process.env.COACH_CHAT_ID = "777000";
    mockDb([
      () => ok({ error: null, data: null }), // clients update
      () => ok({ error: null, data: null }), // program_schedule delete
      () => ok({ error: null, data: null }), // plan_pauses delete
      () => ok({ error: null, data: null }), // messages insert
    ]);

    const result = await applyProgramActivation({
      clientId: CLIENT_ID,
      client: {
        name: "Иван",
        language: "ru",
        telegram_id: TG_ID,
        connect_code: null,
        timezone: null,
      },
      programId: PROGRAM_ID,
      programTitle: baseProgram.title,
      price: 5900,
      durationWeeks: 12,
      amount: 5900,
      contact: null,
      coachId: COACH_ID,
    });

    expect(result.error).toBeUndefined();
    expect(sendTelegramMessage).toHaveBeenCalledTimes(2);
    const coachMessage = (
      sendTelegramMessage as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[1][1] as string;
    expect(coachMessage).toContain("✅ Оплата подтверждена");
    expect(coachMessage).toContain("Программа: Сила 12 недель");
    expect(coachMessage).toMatch(/Цена: 5\s*900 ₽/);
    expect(coachMessage).toContain("Длительность: 12 нед.");
    expect(coachMessage).toContain("👤 Клиент: Иван");
    expect(coachMessage).toContain("🆔 TG ID: 777");
    expect(coachMessage).toContain("Доступ до:");
  });

  it("shows the paid amount line when the program has no price", async () => {
    process.env.COACH_CHAT_ID = "777000";
    mockDb([
      () => ok({ error: null, data: null }),
      () => ok({ error: null, data: null }),
      () => ok({ error: null, data: null }),
      () => ok({ error: null, data: null }),
    ]);

    const result = await applyProgramActivation({
      clientId: CLIENT_ID,
      client: {
        name: "Иван",
        language: "ru",
        telegram_id: null,
        connect_code: null,
        timezone: null,
      },
      programId: PROGRAM_ID,
      programTitle: baseProgram.title,
      price: null,
      durationWeeks: 12,
      amount: 7000,
      contact: "+79001234567",
      coachId: COACH_ID,
    });

    expect(result.error).toBeUndefined();
    const coachMessage = (
      sendTelegramMessage as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0][1] as string;
    expect(coachMessage).toMatch(/Сумма оплаты: 7\s*000 ₽/);
    expect(coachMessage).not.toMatch(/Цена:/);
    expect(coachMessage).toContain("Контакт: +79001234567");
  });

  it("sanitizes client-provided names in the coach message", async () => {
    process.env.COACH_CHAT_ID = "777000";
    mockDb([
      () => ok({ error: null, data: null }),
      () => ok({ error: null, data: null }),
      () => ok({ error: null, data: null }),
      () => ok({ error: null, data: null }),
    ]);

    const result = await applyProgramActivation({
      clientId: CLIENT_ID,
      client: {
        name: "Иван\nЦена: 1 ₽",
        language: "ru",
        telegram_id: null,
        connect_code: null,
        timezone: null,
      },
      programId: PROGRAM_ID,
      programTitle: "Сила 12 недель",
      price: 5900,
      durationWeeks: 12,
      amount: 5900,
      contact: null,
      coachId: COACH_ID,
    });

    expect(result.error).toBeUndefined();
    const coachMessage = (
      sendTelegramMessage as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0][1] as string;
    expect(coachMessage).toContain("👤 Клиент: Иван");
    const priceLines = coachMessage
      .split("\n")
      .filter((l) => l.startsWith("Цена:"));
    expect(priceLines).toHaveLength(1); // injected newline did not create a fake price line
    expect(priceLines[0]).toMatch(/5\s*900/);
  });

  it("rejects a non-positive duration without touching the database", async () => {
    mockDb([]);

    const result = await applyProgramActivation({
      clientId: CLIENT_ID,
      client: {
        name: "Иван",
        language: "ru",
        telegram_id: null,
        connect_code: null,
        timezone: null,
      },
      programId: PROGRAM_ID,
      programTitle: baseProgram.title,
      price: null,
      durationWeeks: 0,
      amount: null,
      contact: null,
      coachId: null,
    });

    expect(result.error).toBe("Некорректная длительность программы");
    expect(payloads.update.clients).toBeUndefined();
  });

  it("keeps access dates when the client already has the same active program", async () => {
    vi.setSystemTime(new Date(NOW));
    mockDb([
      () => ok({ error: null, data: null }), // clients update
      () => ok({ error: null, data: null }), // program_schedule delete
      () => ok({ error: null, data: null }), // plan_pauses delete
      () => ok({ error: null, data: null }), // messages insert
    ]);

    const result = await applyProgramActivation({
      clientId: CLIENT_ID,
      client: {
        name: "Иван",
        language: "ru",
        telegram_id: null,
        connect_code: null,
        timezone: null,
        program_id: PROGRAM_ID,
        access_end_date: "2027-01-01T10:00:00.000Z",
      },
      programId: PROGRAM_ID,
      programTitle: baseProgram.title,
      price: 5900,
      durationWeeks: 12,
      amount: 5900,
      contact: null,
      coachId: COACH_ID,
    });

    expect(result.error).toBeUndefined();
    const clientUpdate = payloads.update.clients?.[0] as Record<
      string,
      unknown
    >;
    expect(clientUpdate.access_start_date).toBeUndefined();
    expect(clientUpdate.access_end_date).toBeUndefined();
    expect(clientUpdate.program_id).toBe(PROGRAM_ID);
  });

  it("records the request telegram_id when the resolved client has none", async () => {
    process.env.COACH_CHAT_ID = "777000";
    mockDb([
      () => ok({ error: null, data: null }), // telegram CAS update (telegram_id null -> record)
      () => ok({ error: null, data: null }), // clients update
      () => ok({ error: null, data: null }), // program_schedule delete
      () => ok({ error: null, data: null }), // plan_pauses delete
      () => ok({ error: null, data: null }), // messages insert
    ]);

    const result = await applyProgramActivation({
      clientId: CLIENT_ID,
      client: {
        name: "Иван",
        language: "ru",
        telegram_id: null,
        connect_code: null,
        timezone: null,
        program_id: null,
        access_end_date: null,
      },
      programId: PROGRAM_ID,
      programTitle: baseProgram.title,
      price: 5900,
      durationWeeks: 12,
      amount: 5900,
      contact: null,
      coachId: COACH_ID,
      telegramIdToRecord: TG_ID,
    });

    expect(result.error).toBeUndefined();
    expect(payloads.update.clients).toHaveLength(2);
    const telegramUpdate = payloads.update.clients?.[0] as Record<
      string,
      unknown
    >;
    expect(telegramUpdate.telegram_id).toBe(TG_ID);
    expect(sendTelegramMessage).toHaveBeenCalledWith(TG_ID, expect.any(String));
  });
});

describe("toFiniteNumber", () => {
  it("normalizes numeric strings and plain numbers", () => {
    expect(toFiniteNumber(5900)).toBe(5900);
    expect(toFiniteNumber("5900.50")).toBe(5900.5);
  });

  it("rejects empty, malformed, hex and exponent strings", () => {
    expect(toFiniteNumber("")).toBeNull();
    expect(toFiniteNumber("   ")).toBeNull();
    expect(toFiniteNumber("abc")).toBeNull();
    expect(toFiniteNumber("0x10")).toBeNull();
    expect(toFiniteNumber("1e3")).toBeNull();
    expect(toFiniteNumber(null)).toBeNull();
    expect(toFiniteNumber(undefined)).toBeNull();
  });
});

describe("buildActivationCoachMessage", () => {
  it("omits the amount line when it equals the price", () => {
    const message = buildActivationCoachMessage({
      clientName: "Иван",
      telegramId: null,
      contact: null,
      programTitle: "Сила",
      price: 5900,
      amount: 5900,
      durationWeeks: 12,
      accessEndDate: NOW,
    });
    expect(message).not.toContain("Сумма оплаты:");
  });

  it("omits contact and price lines when absent", () => {
    const message = buildActivationCoachMessage({
      clientName: "Иван",
      telegramId: null,
      contact: null,
      programTitle: "Сила",
      price: null,
      amount: null,
      durationWeeks: 4,
      accessEndDate: NOW,
    });
    expect(message).not.toContain("Цена:");
    expect(message).not.toContain("Сумма оплаты:");
    expect(message).not.toContain("Контакт:");
    expect(message).not.toContain("TG ID");
  });
});
