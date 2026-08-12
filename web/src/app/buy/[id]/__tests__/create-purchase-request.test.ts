import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("@/lib/telegram", () => ({
  sendTelegramMessage: vi.fn(),
}));

import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendTelegramMessage } from "@/lib/telegram";
import { createPurchaseRequest } from "../actions";

const UUID = "11111111-2222-3333-4444-555555555555";

type QueryCall = { method: string; args: unknown[] };

function buildTable(calls: QueryCall[], programData: unknown) {
  const chain = {
    select: (...args: unknown[]) => {
      calls.push({ method: "select", args });
      return chain;
    },
    eq: (...args: unknown[]) => {
      calls.push({ method: "eq", args });
      return chain;
    },
    is: (...args: unknown[]) => {
      calls.push({ method: "is", args });
      return chain;
    },
    lt: (...args: unknown[]) => {
      calls.push({ method: "lt", args });
      return chain;
    },
    delete: (...args: unknown[]) => {
      calls.push({ method: "delete", args });
      return chain;
    },
    maybeSingle: vi.fn(() => {
      calls.push({ method: "maybeSingle", args: [] });
      return Promise.resolve({ data: programData, error: null });
    }),
    insert: vi.fn((...args: unknown[]) => {
      calls.push({ method: "insert", args });
      return Promise.resolve({ error: null });
    }),
    then: (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ error: null }).then(onFulfilled),
  };
  return chain;
}

let ipCounter = 0;

function mockDb(programData: unknown) {
  const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  const byTable = new Map<string, QueryCall[]>();
  fake.from.mockImplementation((table: string) => {
    if (!byTable.has(table)) byTable.set(table, []);
    return buildTable(byTable.get(table)!, table === "programs" ? programData : null);
  });
  return { calls: (table: string) => byTable.get(table) ?? [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.COACH_CHAT_ID = "123";
  ipCounter += 1;
  (headers as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    get: () => `10.0.0.${ipCounter}`,
  });
  (sendTelegramMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
    true,
  );
});

describe("createPurchaseRequest", () => {
  it("queries with type=template and refuses a program that is not returned", async () => {
    const { calls } = mockDb(null);

    const result = await createPurchaseRequest({
      programId: UUID,
      name: "Иван",
      contact: "ivan",
      telegramId: "123456",
      telegramUsername: "ivan",
    });

    expect(result.error).toBe("Программа недоступна для покупки.");
    const eqArgs = calls("programs")
      .filter((c) => c.method === "eq")
      .map((c) => c.args);
    expect(eqArgs).toContainEqual(["type", "template"]);
    expect(eqArgs).toContainEqual(["active", true]);
  });

  it("rejects a program row that is marked personal", async () => {
    mockDb({
      id: UUID,
      title: "Персональная программа",
      type: "personal",
      description: null,
      duration_weeks: 12,
      price: null,
    });

    const result = await createPurchaseRequest({
      programId: UUID,
      name: "Иван",
      contact: "ivan",
    });

    expect(result.error).toBe("Программа недоступна для покупки.");
  });

  it("accepts a template program and notifies the coach", async () => {
    const { calls } = mockDb({
      id: UUID,
      title: "Сила Новичка 12 недель",
      type: "template",
      description: null,
      duration_weeks: 12,
      price: 9900,
    });

    const result = await createPurchaseRequest({
      programId: UUID,
      name: "Иван",
      contact: "ivan",
    });

    expect(result.error).toBeUndefined();
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      "123",
      expect.stringContaining("Сила Новичка 12 недель"),
    );
    expect(calls("bot_logs").some((c) => c.method === "insert")).toBe(true);
  });

  it("rejects an invalid program id", async () => {
    const result = await createPurchaseRequest({
      programId: "not-a-uuid",
      name: "Иван",
      contact: "ivan",
    });
    expect(result.error).toBe("Некорректная программа.");
  });
});
