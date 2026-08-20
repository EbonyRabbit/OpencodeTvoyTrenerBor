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
};

function record(
  bucket: Record<string, unknown[]>,
  table: string,
  payload: unknown,
) {
  (bucket[table] ??= []).push(payload);
}

type Handlers = Record<string, (() => Promise<ChainRes>) | string>;

function mockDb(calls: Array<() => Promise<ChainRes>>) {
  const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  fake.from.mockReset();
  let idx = 0;
  fake.from.mockImplementation((table: string) => {
    const link = {
      select: () => link,
      eq: () => link,
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

  it("returns alreadyActivated for a paid request without touching clients", async () => {
    mockDb([
      () => ok({ ...pendingRequest, status: "paid", client_id: CLIENT_ID }),
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.alreadyActivated).toBe(true);
    expect(result.requestId).toBe(REQUEST_ID);
    expect(payloads.update.clients).toBeUndefined();
    expect(payloads.insert.clients).toBeUndefined();
  });
});

describe("activatePurchaseByOrder: client resolution", () => {
  it("creates a new client from request data and activates", async () => {
    mockDb([
      () => ok(pendingRequest),
      () => ok(baseProgram),
      () => ok({ id: CLIENT_ID }), // insert -> maybeSingle
      () => ok({ error: null, data: null }), // clients update (await then)
      () => ok({ error: null, data: null }), // program_schedule delete
      () => ok({ error: null, data: null }), // plan_pauses delete
      () => ok({ error: null, data: null }), // connect-code update
      () => ok({ error: null, data: null }), // messages insert
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

    const claim = payloads.update.purchase_requests?.find(
      (p) => (p as Record<string, unknown>).status === "paid",
    ) as Record<string, unknown>;
    expect(claim.status).toBe("paid");
    expect(claim.paid_at).toBeTruthy();
    expect(claim.client_id).toBe(CLIENT_ID);

    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("reuses an existing client found by telegram_id and skips creation", async () => {
    mockDb([
      () => ok({ ...pendingRequest, telegram_id: TG_ID }),
      () => ok(baseProgram),
      () => ok(existingClient), // telegram lookup hit
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
    // telegram lookup is skipped when client_id is set; only the id lookup runs
    mockDb([
      () => ok({ ...pendingRequest, client_id: CLIENT_ID }),
      () => ok(baseProgram),
      () => ok(existingClient), // lookup by id
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
    expect(result.clientId).toBe(CLIENT_ID);
    expect(payloads.insert.clients).toBeUndefined();
  });

  it("retries by telegram_id when client creation hits a 23505 race", async () => {
    mockDb([
      () => ok({ ...pendingRequest, telegram_id: TG_ID }),
      () => ok(baseProgram),
      () => ok(null), // telegram lookup miss
      () => err("duplicate", "23505"), // insert fails
      () => ok(existingClient), // retry lookup by telegram_id
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
    expect(result.clientId).toBe(CLIENT_ID);
    expect(sendTelegramMessage).toHaveBeenCalledWith(TG_ID, expect.any(String));
  });

  it("falls back to the raw name when first/last names are absent", async () => {
    mockDb([
      () => ok({ ...pendingRequest, first_name: null, last_name: null }),
      () => ok(baseProgram),
      () => ok({ id: CLIENT_ID }),
      () => ok({ error: null, data: null }),
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
    const insert = payloads.insert.clients?.[0] as Record<string, unknown>;
    expect(insert.name).toBe("Иван Петров");
  });
});

describe("activatePurchaseByOrder: reactivation of expired clients", () => {
  it("re-activates an access_expired client with fresh access dates", async () => {
    vi.setSystemTime(new Date(NOW));
    mockDb([
      () => ok({ ...pendingRequest, client_id: CLIENT_ID }),
      () => ok(baseProgram),
      () => ok(existingClient),
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
  it("reports alreadyActivated when the claim loses a race but the request is paid", async () => {
    mockDb([
      () => ok({ ...pendingRequest, client_id: CLIENT_ID }),
      () => ok(baseProgram),
      () => ok(existingClient), // lookup by id
      () => ok(null), // claim update -> maybeSingle returns no row
      () => ok({ ...pendingRequest, status: "paid" }), // current status re-read
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.alreadyActivated).toBe(true);
    expect(result.clientId).toBe(CLIENT_ID);
  });

  it("rolls the claim back when activation fails", async () => {
    (generateSchedule as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        error: "план не создался",
      },
    );
    mockDb([
      () => ok({ ...pendingRequest, client_id: CLIENT_ID }),
      () => ok(baseProgram),
      () => ok(existingClient), // lookup by id
      () => ok({ data: { id: REQUEST_ID }, error: null }), // claim success
      () => ok({ error: null, data: null }), // clients update
      () => ok({ error: null, data: null }), // program_schedule delete
      () => ok({ error: null, data: null }), // plan_pauses delete
      // no messages - schedule error short-circuits assignProgramAndNotify
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toContain("расписание");
    expect(result.requestId).toBe(REQUEST_ID);

    const rollback = payloads.update.purchase_requests?.find(
      (p) => (p as Record<string, unknown>).paid_at === null,
    ) as Record<string, unknown>;
    expect(rollback.status).toBe("pending");
  });

  it("returns an error when the claim itself fails", async () => {
    mockDb([
      () => ok({ ...pendingRequest, client_id: CLIENT_ID }),
      () => ok(baseProgram),
      () => ok(existingClient),
      () => err("boom"),
    ]);

    const result = await activatePurchaseByOrder({
      orderId: ORDER_ID,
      coachId: COACH_ID,
    });
    expect(result.error).toBe("Ошибка обновления статуса заказа.");
    expect(payloads.update.clients).toBeUndefined();
  });
});

describe("activatePurchaseByOrder: connect code for clients without telegram", () => {
  it("generates and returns a connect code when the client has no telegram_id and no code", async () => {
    mockDb([
      () => ok({ ...pendingRequest, client_id: CLIENT_ID }),
      () => ok(baseProgram),
      () => ok({ ...existingClient, telegram_id: null, connect_code: null }), // lookup by id
      () => ok({ error: null, data: null }), // clients update (activation)
      () => ok({ error: null, data: null }), // program_schedule delete
      () => ok({ error: null, data: null }), // plan_pauses delete
      () => ok({ error: null, data: null }), // connect-code update
      () => ok({ error: null, data: null }), // messages insert
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
      () => ok({ ...pendingRequest, client_id: CLIENT_ID }),
      () => ok(baseProgram),
      () =>
        ok({ ...existingClient, telegram_id: null, connect_code: "OLD12345" }),
      () => ok({ error: null, data: null }), // clients update (activation)
      () => ok({ error: null, data: null }), // program_schedule delete
      () => ok({ error: null, data: null }), // plan_pauses delete
      () => ok({ error: null, data: null }), // messages insert
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
