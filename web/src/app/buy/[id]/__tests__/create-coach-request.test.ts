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
import {
  createCoachRequest,
} from "../actions";
import { COACH_REQUEST_ALREADY_SENT_MESSAGE } from "@/lib/purchase";
import { PRIVACY_POLICY_VERSION } from "@/lib/consent";

type QueryCall = { method: string; args: unknown[] };

type InsertEntry = { data?: unknown; error?: unknown };

type MockOptions = {
  pendingIndivid?: unknown;
  pendingIndividRows?: unknown[];
  insertEntries?: InsertEntry[];
  tgDedupError?: unknown;
  purgeError?: unknown;
};

const captured = new Map<string, QueryCall[]>();

function mockDb(opts: MockOptions = {}) {
  const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  const insertQueue = [...(opts.insertEntries ?? [])];
  const defaultEntry: InsertEntry = { data: { id: "req-1" }, error: null };

  fake.from.mockImplementation((table: string) => {
    const chainCalls: QueryCall[] = [];
    const push = (method: string, args: unknown[]) => {
      const call = { method, args };
      chainCalls.push(call);
      const tableCalls = captured.get(table) ?? [];
      tableCalls.push(call);
      captured.set(table, tableCalls);
      return chain;
    };
    let chainInsertEntry: InsertEntry | null = null;

    const resolveFor = (kind: "single" | "list") => {
      if (table === "purchase_requests") {
        if (chainInsertEntry || chainCalls.some((c) => c.method === "insert")) {
          return { data: chainInsertEntry?.data ?? null, error: chainInsertEntry?.error ?? null };
        }
        return kind === "single"
          ? { data: opts.pendingIndivid ?? null, error: null }
          : { data: opts.pendingIndividRows ?? [], error: null };
      }
      return {
        data: null,
        error:
          table === "bot_dedup" ? (opts.tgDedupError ?? null) : null,
      };
    };

    const chain = {
      select: (...args: unknown[]) => push("select", args),
      eq: (...args: unknown[]) => push("eq", args),
      lt: (...args: unknown[]) => push("lt", args),
      delete: (...args: unknown[]) => push("delete", args),
      limit: (...args: unknown[]) => push("limit", args),
      insert: (...args: unknown[]) => {
        push("insert", args);
        if (table === "purchase_requests") {
          chainInsertEntry = insertQueue.shift() ?? defaultEntry;
        } else if (table === "bot_dedup") {
          chainInsertEntry = { data: null, error: opts.tgDedupError ?? null };
        }
        return chain;
      },
      maybeSingle: () => Promise.resolve(resolveFor("single")),
      then: (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve(resolveFor("list")).then(onFulfilled),
    };
    return chain;
  });

  return { calls: (table: string) => captured.get(table) ?? [] };
}

let ipCounter = 0;

beforeEach(() => {
  vi.clearAllMocks();
  captured.clear();
  process.env.COACH_CHAT_ID = "123";
  ipCounter += 1;
  (headers as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    get: () => `10.1.0.${ipCounter}`,
  });
  (sendTelegramMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
    true,
  );
});

const baseInput = {
  name: "Иван",
  contact: "ivan",
  consentGiven: true,
};

describe("createCoachRequest", () => {
  it("rejects a request without consent", async () => {
    mockDb();
    const result = await createCoachRequest({ ...baseInput, consentGiven: false });
    expect(result.error).toBe(
      "Необходимо согласие на обработку персональных данных.",
    );
    expect(captured.get("purchase_requests")).toBeUndefined();
  });

  it("rejects empty name and invalid contact", async () => {
    mockDb();
    expect((await createCoachRequest({ ...baseInput, name: "" })).error).toBe(
      "Укажите ваше имя.",
    );
    expect(
      await createCoachRequest({ ...baseInput, contact: "не-контакт!!!" }),
    ).toEqual({ error: "Укажите @username или номер телефона." });
  });

  it("creates an individ request for a web user and notifies the coach", async () => {
    const { calls } = mockDb();

    const result = await createCoachRequest({
      ...baseInput,
      telegramId: null,
      telegramUsername: "ivan_web",
    });

    expect(result.error).toBeUndefined();

    const inserts = calls("purchase_requests").filter(
      (c) => c.method === "insert",
    );
    expect(inserts).toHaveLength(1);
    const payload = inserts[0].args[0] as Record<string, unknown>;
    expect(payload.sub_type).toBe("individ");
    expect(payload.status).toBe("pending");
    expect(payload.name).toBe("Иван");
    expect(payload.contact).toBe("ivan");
    expect(payload.consent_given).toBe(true);
    expect(payload.consent_at).toEqual(expect.any(String));
    expect(payload.consent_version).toBe(PRIVACY_POLICY_VERSION);
    expect(payload.telegram_id).toBeNull();

    const dedupCalls = calls("bot_dedup").map((c) => c.method);
    expect(dedupCalls).toContain("delete");
    expect(dedupCalls.indexOf("delete")).toBeLessThan(
      dedupCalls.indexOf("insert"),
    );

    const logInserts = calls("bot_logs").filter(
      (c) => c.method === "insert",
    );
    expect(logInserts.some((c) => (c.args[0] as { action: string }).action === "coach_request")).toBe(
      true,
    );

    expect(sendTelegramMessage).toHaveBeenCalledWith(
      "123",
      expect.stringContaining("Иван"),
    );
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      "123",
      expect.stringContaining("ivan"),
    );
  });

  it("deduplicates a new web submission by pending contact", async () => {
    mockDb({ pendingIndividRows: [{ id: "r1", contact: "Ivan" }] });

    const result = await createCoachRequest(baseInput);

    expect(result.error).toBe(COACH_REQUEST_ALREADY_SENT_MESSAGE);
    expect(
      captured.get("purchase_requests")?.some((c) => c.method === "insert"),
    ).toBe(false);
  });

  it("deduplicates a submission by pending telegram id", async () => {
    mockDb({ pendingIndivid: { id: "r1", contact: "ivan" } });

    const result = await createCoachRequest({
      ...baseInput,
      telegramId: "987654321",
    });

    expect(result.error).toBe(COACH_REQUEST_ALREADY_SENT_MESSAGE);
  });

  it("stores the telegram id on the row when provided by the bot", async () => {
    const { calls } = mockDb();

    const result = await createCoachRequest({
      ...baseInput,
      telegramId: "987654321",
    });

    expect(result.error).toBeUndefined();
    const payload = calls("purchase_requests").filter((c) => c.method === "insert")[0]
      .args[0] as Record<string, unknown>;
    expect(payload.telegram_id).toBe(987654321);
  });

  it("treats a pending bot_dedup collision as already sent", async () => {
    mockDb({ tgDedupError: { code: "23505", message: "duplicate" } });

    const result = await createCoachRequest(baseInput);

    expect(result.error).toBe(
      "Заявка уже отправлена. Тренер скоро свяжется с вами.",
    );
  });

  it("maps a unique-index collision to already sent when a pending row exists", async () => {
    mockDb({
      pendingIndivid: { id: "winner", contact: "ivan" },
      insertEntries: [{ data: null, error: { code: "23505" } }],
    });

    const result = await createCoachRequest({
      ...baseInput,
      telegramId: "987654321",
    });

    expect(result.error).toBe(COACH_REQUEST_ALREADY_SENT_MESSAGE);
  });

  it("retries once when a unique index collision has no winner", async () => {
    const { calls } = mockDb({
      insertEntries: [
        { data: null, error: { code: "23505" } },
        { data: { id: "req-2" }, error: null },
      ],
    });

    const result = await createCoachRequest({
      ...baseInput,
      telegramId: "987654321",
    });

    expect(result.error).toBeUndefined();
    const inserts = calls("purchase_requests").filter(
      (c) => c.method === "insert",
    );
    expect(inserts).toHaveLength(2);
  });

  it("returns a generic error when the storage insert fails", async () => {
    mockDb({ insertEntries: [{ data: null, error: { message: "boom" } }] });

    const result = await createCoachRequest(baseInput);

    expect(result.error).toBe("Произошла ошибка. Попробуйте позже.");
  });
});