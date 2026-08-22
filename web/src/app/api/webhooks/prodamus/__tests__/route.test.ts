import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("@/lib/telegram", () => ({
  sendTelegramMessage: vi.fn(),
}));

vi.mock("@/lib/activate-purchase", () => ({
  activatePurchaseByOrder: vi.fn(),
}));

import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendTelegramMessage } from "@/lib/telegram";
import { activatePurchaseByOrder } from "@/lib/activate-purchase";
import { buildProdamusSignature } from "@/lib/prodamus";
import { POST } from "../route";

const ORDER_ID = "c3f0a2bc-1111-4990-8a58-6a0c8a4f2b01";
const SECRET = "test-secret-key";

type ChainRes = { data?: unknown; error?: { message: string } | null };

function mockDb(calls: Array<() => Promise<ChainRes>>) {
  const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  fake.from.mockReset();
  let idx = 0;
  fake.from.mockImplementation(() => {
    const link = {
      select: () => link,
      eq: () => link,
      is: () => link,
      update: () => link,
      delete: () => link,
      maybeSingle: () => {
        const step = calls[idx++];
        if (!step) return Promise.resolve({ data: null, error: null });
        return step();
      },
    };
    return link;
  });
}

function signedRequest(
  fields: Record<string, string>,
  secret = SECRET,
): Request {
  const body = new URLSearchParams(fields).toString();
  const sign = secret === "" ? "" : buildProdamusSignature(body, secret);
  return new Request("http://localhost/api/webhooks/prodamus", {
    method: "POST",
    headers: { sign },
    body,
  });
}

const activationMock = vi.mocked(activatePurchaseByOrder);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PRODAMUS_SECRET_KEY", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("prodamus webhook", () => {
  it("fails closed when PRODAMUS_SECRET_KEY is not set", async () => {
    vi.stubEnv("PRODAMUS_SECRET_KEY", "");
    const res = await POST(signedRequest({ order_id: ORDER_ID }));
    expect(res.status).toBe(500);
  });

  it("rejects an invalid signature with 400", async () => {
    const res = await POST(signedRequest({ order_id: ORDER_ID }, "wrong"));
    expect(res.status).toBe(400);
    expect(activationMock).not.toHaveBeenCalled();
  });

  it("rejects a verified payload without order_id", async () => {
    const res = await POST(signedRequest({ payment_status: "success" }));
    expect(res.status).toBe(400);
    expect(activationMock).not.toHaveBeenCalled();
  });

  it("activates a successful payment and answers 200", async () => {
    activationMock.mockResolvedValueOnce({});
    const res = await POST(
      signedRequest({
        order_id: ORDER_ID,
        payment_status: "success",
        sum: "5900",
      }),
    );
    expect(res.status).toBe(200);
    expect(activationMock).toHaveBeenCalledWith({
      orderId: ORDER_ID,
      coachId: null,
      paymentStatus: "success",
      paidSum: 5900,
    });
  });

  it("answers 200 idempotently when already activated", async () => {
    activationMock.mockResolvedValueOnce({ alreadyActivated: true });
    const res = await POST(
      signedRequest({ order_id: ORDER_ID, payment_status: "success" }),
    );
    expect(res.status).toBe(200);
  });

  it("answers 503 so prodamus retries while activation is in progress", async () => {
    activationMock.mockResolvedValueOnce({
      error: "Активация уже выполняется. Повторите запрос позднее.",
    });
    const res = await POST(
      signedRequest({ order_id: ORDER_ID, payment_status: "success" }),
    );
    expect(res.status).toBe(503);
  });

  it("answers 500 on activation failure", async () => {
    activationMock.mockResolvedValueOnce({
      error: "Программа не найдена или недоступна.",
    });
    const res = await POST(
      signedRequest({ order_id: ORDER_ID, payment_status: "success" }),
    );
    expect(res.status).toBe(500);
  });

  it("marks a pending request cancelled and notifies the coach", async () => {
    vi.stubEnv("COACH_CHAT_ID", "42");
    const sent = vi.mocked(sendTelegramMessage).mockResolvedValueOnce(true);
    mockDb([
      () =>
        Promise.resolve({
          data: {
            name: "Иван Петров",
            contact: "+79001234567",
            telegram_id: null,
            amount: 5900,
            sub_type: "program",
          },
          error: null,
        }), // cancel CAS hits pending row
    ]);
    const res = await POST(
      signedRequest({ order_id: ORDER_ID, payment_status: "order_canceled" }),
    );
    expect(res.status).toBe(200);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0][0]).toBe("42");
    expect(sent.mock.calls[0][1]).toContain("Иван Петров");
    expect(sent.mock.calls[0][1]).toContain("отменена");
    expect(activationMock).not.toHaveBeenCalled();
  });

  it("does not cancel a paid request", async () => {
    mockDb([
      () => Promise.resolve({ data: null, error: null }), // cancel CAS misses
      () => Promise.resolve({ data: { status: "paid" }, error: null }), // re-read
    ]);
    const res = await POST(
      signedRequest({ order_id: ORDER_ID, payment_status: "order_denied" }),
    );
    expect(res.status).toBe(200);
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("ignores other payment statuses with 200", async () => {
    const res = await POST(
      signedRequest({ order_id: ORDER_ID, payment_status: "fail" }),
    );
    expect(res.status).toBe(200);
    expect(activationMock).not.toHaveBeenCalled();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});
