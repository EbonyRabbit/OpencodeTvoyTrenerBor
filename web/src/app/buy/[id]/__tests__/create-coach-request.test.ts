import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

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
import { createCoachRequest } from "../actions";
import { COACH_REQUEST_ALREADY_SENT_MESSAGE } from "@/lib/purchase";
import { PRIVACY_POLICY_VERSION } from "@/lib/consent";

type QueryCall = { method: string; args: unknown[] };

type InsertEntry = { data?: unknown; error?: unknown };

type MockOptions = {
  pendingIndividRows?: unknown[];
  insertEntries?: InsertEntry[];
  tgDedupError?: unknown;
  pendingContactError?: unknown;
  logError?: unknown;
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
          return {
            data: chainInsertEntry?.data ?? null,
            error: chainInsertEntry?.error ?? null,
          };
        }
        return kind === "single"
          ? { data: null, error: null }
          : {
              data: opts.pendingIndividRows ?? [],
              error: opts.pendingContactError ?? null,
            };
      }
      return {
        data: null,
        error: table === "bot_dedup" ? (opts.tgDedupError ?? null) : null,
      };
    };

    const chain = {
      select: (...args: unknown[]) => push("select", args),
      eq: (...args: unknown[]) => push("eq", args),
      lt: (...args: unknown[]) => push("lt", args),
      delete: (...args: unknown[]) => push("delete", args),
      limit: (...args: unknown[]) => push("limit", args),
      order: (...args: unknown[]) => push("order", args),
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
      then: (
        onFulfilled: (v: unknown) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) => {
        const value = resolveFor("list");
        if (opts.logError && table === "bot_logs") {
          return Promise.reject(opts.logError).then(onFulfilled, onRejected);
        }
        return Promise.resolve(value).then(onFulfilled, onRejected);
      },
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
  (
    sendTelegramMessage as unknown as ReturnType<typeof vi.fn>
  ).mockResolvedValue(true);
});

const baseInput = {
  username: "@Ivan_User",
  consentGiven: true,
  age18: true,
};

describe("createCoachRequest", () => {
  it("rejects a request without 18+", async () => {
    mockDb();
    const result = await createCoachRequest({ ...baseInput, age18: false });
    expect(result.error).toBe(
      "Необходимо подтвердить, что вам исполнилось 18 лет.",
    );
    expect(captured.get("purchase_requests")).toBeUndefined();
  });

  it("rejects a request without consent", async () => {
    mockDb();
    const result = await createCoachRequest({
      ...baseInput,
      consentGiven: false,
    });
    expect(result.error).toBe(
      "Необходимо согласие на обработку персональных данных.",
    );
    expect(captured.get("purchase_requests")).toBeUndefined();
  });

  it("rejects invalid username", async () => {
    mockDb();
    expect(
      (await createCoachRequest({ ...baseInput, username: "" })).error,
    ).toBe("Укажите Telegram username (например, @username).");
    expect(
      (await createCoachRequest({ ...baseInput, username: "ab" })).error,
    ).toBe("Укажите Telegram username (например, @username).");
  });

  it("creates an individ request and notifies the coach without legacy identity fields", async () => {
    const { calls } = mockDb();

    const result = await createCoachRequest(baseInput);

    expect(result.error).toBeUndefined();

    const inserts = calls("purchase_requests").filter(
      (c) => c.method === "insert",
    );
    expect(inserts).toHaveLength(1);
    const payload = inserts[0].args[0] as Record<string, unknown>;
    expect(payload.sub_type).toBe("individ");
    expect(payload.status).toBe("pending");
    expect(payload.name).toBe("@ivan_user");
    expect(Object.keys(payload)).not.toEqual(
      expect.arrayContaining(["contact", "first_name", "last_name"]),
    );
    expect(payload.consent_given).toBe(true);
    expect(payload.consent_at).toEqual(expect.any(String));
    expect(payload.consent_version).toBe(PRIVACY_POLICY_VERSION);
    expect(payload.telegram_id).toBeNull();

    const dedupCalls = calls("bot_dedup").map((c) => c.method);
    expect(dedupCalls).toContain("delete");
    expect(dedupCalls.indexOf("delete")).toBeLessThan(
      dedupCalls.indexOf("insert"),
    );
    const dedupInsertKey = calls("bot_dedup")
      .filter((c) => c.method === "insert")
      .map((c) => (c.args[0] as { key: string }).key);
    expect(dedupInsertKey).toContain(
      `individ:${createHash("sha256").update("ivan_user").digest("hex")}`,
    );

    expect(sendTelegramMessage).toHaveBeenCalledWith(
      "123",
      expect.stringContaining("@ivan_user"),
    );
    const msg = (sendTelegramMessage as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0][1] as string;
    expect(msg).not.toContain("Контакт");
    expect(msg).not.toContain("TG ID");
  });

  it("orders the pending-username pre-read by recency", async () => {
    const { calls } = mockDb();
    await createCoachRequest(baseInput);
    const orderArgs = calls("purchase_requests")
      .filter((c) => c.method === "order")
      .map((c) => c.args);
    expect(orderArgs).toContainEqual(["created_at", { ascending: false }]);
  });

  it("deduplicates a new web submission by pending normalized username", async () => {
    mockDb({ pendingIndividRows: [{ id: "r1", name: "@Ivan_User" }] });

    const result = await createCoachRequest(baseInput);

    expect(result.error).toBe(COACH_REQUEST_ALREADY_SENT_MESSAGE);
    expect(
      captured.get("purchase_requests")?.some((c) => c.method === "insert"),
    ).toBe(false);
  });

  it("fails closed when the pending-username pre-read errors out", async () => {
    mockDb({ pendingContactError: { message: "db down" } });

    const result = await createCoachRequest(baseInput);

    expect(result.error).toBe("Произошла ошибка. Попробуйте позже.");
    expect(
      captured.get("purchase_requests")?.some((c) => c.method === "insert"),
    ).toBe(false);
  });

  it("treats a pending bot_dedup collision as already sent", async () => {
    mockDb({ tgDedupError: { code: "23505", message: "duplicate" } });

    const result = await createCoachRequest(baseInput);

    expect(result.error).toBe(
      "Заявка уже отправлена. Тренер скоро свяжется с вами.",
    );
  });

  it("fails closed when the dedup key cannot be written", async () => {
    mockDb({ tgDedupError: { message: "db down" } });

    const result = await createCoachRequest(baseInput);

    expect(result.error).toBe("Произошла ошибка. Попробуйте позже.");
    expect(
      captured.get("purchase_requests")?.some((c) => c.method === "insert"),
    ).toBe(false);
  });

  it("keeps the request successful even if the bot_logs insert rejects", async () => {
    mockDb({ logError: new Error("network down") });

    const result = await createCoachRequest(baseInput);

    expect(result.error).toBeUndefined();
    expect(sendTelegramMessage).toHaveBeenCalled();
  });

  it("returns a generic error when the storage insert fails", async () => {
    mockDb({ insertEntries: [{ data: null, error: { message: "boom" } }] });

    const result = await createCoachRequest(baseInput);

    expect(result.error).toBe("Произошла ошибка. Попробуйте позже.");
  });
});
