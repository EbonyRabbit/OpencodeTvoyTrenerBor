import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "grammy";
import type { MyContext } from "../../bot.js";
import { supabaseAdmin } from "../../lib/supabase-admin.js";
import { deleteDedup, markAsSent } from "../dedup.js";
import { logBotEvent } from "../logger.js";
import { runPolicyNotice } from "../policy-notice.js";

vi.mock("../../lib/supabase-admin.js", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("../dedup.js", () => ({
  markAsSent: vi.fn(),
  deleteDedup: vi.fn(),
}));

vi.mock("../logger.js", () => ({
  logBotEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../handlers/consent.js", () => ({
  PRIVACY_POLICY_VERSION: "test-version",
  buildPrivacyUrl: () => "https://example.test/privacy",
}));

const insertedLogs: Record<string, unknown>[] = [];
let clientChain: Record<string, unknown>;

type QueryResult = { data: unknown; error: unknown };

function makeChain(getResult: () => QueryResult, table?: string) {
  const chain: Record<string, unknown> = {};
  for (
    const method of ["select", "not", "eq", "in", "lt", "gt", "order", "limit"]
  ) {
    chain[method] = () => chain;
  }
  chain.update = vi.fn(() => chain);
  chain.insert = (row: Record<string, unknown>) => {
    if (table === "bot_logs") insertedLogs.push(row);
    return chain;
  };
  chain.then = (
    onFulfilled: (value: QueryResult) => unknown,
  ) => Promise.resolve(getResult()).then(onFulfilled);
  return chain;
}

function mockDb(pages: unknown[][]) {
  insertedLogs.length = 0;
  let pageIndex = 0;
  const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  fromMock.from.mockImplementation((table: string) => {
    if (table === "clients") {
      clientChain = makeChain(() => ({
        data: pages[pageIndex++] ?? [],
        error: null,
      }));
      return clientChain;
    }
    if (table === "bot_logs") {
      return makeChain(() => ({ data: null, error: null }), table);
    }
    throw new Error(`Unexpected table: ${table}`);
  });
}

function makeBot() {
  const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
  const bot = { api: { sendMessage } } as unknown as Bot<MyContext>;
  return { bot, sendMessage };
}

describe("runPolicyNotice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(markAsSent).mockResolvedValue("sent");
    vi.mocked(deleteDedup).mockResolvedValue(true);
  });

  it("notifies only clients with stale consent version", async () => {
    mockDb([[
      {
        id: "c1",
        telegram_id: 111,
        language: "ru",
        client_consent_version: "old",
      },
      {
        id: "c2",
        telegram_id: 222,
        language: "en",
        client_consent_version: "test-version",
      },
    ]]);
    const { bot, sendMessage } = makeBot();

    await runPolicyNotice(bot);

    expect(markAsSent).toHaveBeenCalledTimes(1);
    expect(markAsSent).toHaveBeenCalledWith("policy_notice:test-version:c1", 8760);
    expect(clientChain.update).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toBe(111);
    expect(sendMessage.mock.calls[0][1]).toContain("https://example.test/privacy");
    expect(insertedLogs).toHaveLength(1);
    expect(insertedLogs[0]).toMatchObject({
      action: "policy_notice",
      client_id: "c1",
      telegram_id: 111,
      status: "ok",
      details: "test-version",
    });
  });

  it("paginates beyond the first batch", async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => ({
      id: `current-${index}`,
      telegram_id: 1000 + index,
      language: "ru",
      client_consent_version: "test-version",
    }));
    mockDb([firstPage, [
      {
        id: "stale-last",
        telegram_id: 9999,
        language: "ru",
        client_consent_version: "old",
      },
    ]]);
    const { bot, sendMessage } = makeBot();

    await runPolicyNotice(bot);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toBe(9999);
    expect(markAsSent).toHaveBeenCalledWith(
      "policy_notice:test-version:stale-last",
      8760,
    );
  });

  it("skips duplicate notification", async () => {
    mockDb([[
      {
        id: "c1",
        telegram_id: 111,
        language: "ru",
        client_consent_version: "old",
      },
    ]]);
    vi.mocked(markAsSent).mockResolvedValue("duplicate");
    const { bot, sendMessage } = makeBot();

    await runPolicyNotice(bot);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(insertedLogs).toHaveLength(0);
  });

  it("keeps dedup on permanent send failure", async () => {
    mockDb([[
      {
        id: "c1",
        telegram_id: 111,
        language: "ru",
        client_consent_version: "old",
      },
    ]]);
    const { bot, sendMessage } = makeBot();
    sendMessage.mockRejectedValue({ error_code: 403 });

    await runPolicyNotice(bot);

    expect(deleteDedup).not.toHaveBeenCalled();
    expect(logBotEvent).toHaveBeenCalled();
    expect(insertedLogs).toHaveLength(0);
  });

  it("releases dedup on generic 400 send failure", async () => {
    mockDb([[
      {
        id: "c1",
        telegram_id: 111,
        language: "ru",
        client_consent_version: "old",
      },
    ]]);
    const { bot, sendMessage } = makeBot();
    sendMessage.mockRejectedValue({ error_code: 400, description: "Bad Request" });

    await runPolicyNotice(bot);

    expect(deleteDedup).toHaveBeenCalledWith("policy_notice:test-version:c1");
    expect(insertedLogs).toHaveLength(0);
  });

  it("releases dedup on transient send failure", async () => {
    mockDb([[
      {
        id: "c1",
        telegram_id: 111,
        language: "ru",
        client_consent_version: "old",
      },
    ]]);
    const { bot, sendMessage } = makeBot();
    sendMessage.mockRejectedValue(new Error("network"));

    await runPolicyNotice(bot);

    expect(deleteDedup).toHaveBeenCalledWith("policy_notice:test-version:c1");
    expect(insertedLogs).toHaveLength(0);
  });
});
