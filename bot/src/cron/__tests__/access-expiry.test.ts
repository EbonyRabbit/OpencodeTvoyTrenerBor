import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabaseAdmin } from "../../lib/supabase-admin.js";
import { markAsSent, deleteDedup } from "../dedup.js";
import {
  runAccessExpiryReminder,
  accessExpiryWindow,
  formatExpiryDate,
  buildAccessExpiryMessage,
} from "../access-expiry.js";

vi.mock("../../lib/supabase-admin.js", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("../dedup.js", () => ({
  markAsSent: vi.fn(),
  deleteDedup: vi.fn(),
  isSent: vi.fn(),
  cleanupExpired: vi.fn(),
}));

vi.mock("../logger.js", () => ({
  logBotEvent: vi.fn().mockResolvedValue(undefined),
}));

function makeChain(
  terminal: { data: unknown; error: unknown } | null,
  table?: string,
) {
  const chain: Record<string, unknown> = {};
  const self = (method: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (...args: any[]) => {
      if (method === "insert" && table && insertedRows[table]) {
        insertedRows[table].push(args[0]);
      }
      return chain;
    };
  };
  for (const m of [
    "select",
    "eq",
    "is",
    "not",
    "gte",
    "lt",
    "order",
    "range",
    "limit",
    "insert",
    "update",
    "delete",
  ]) {
    chain[m] = self(m);
  }
  chain.maybeSingle = () => Promise.resolve(terminal ?? { data: null, error: null });
  chain.then = (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) =>
    Promise.resolve(terminal ?? { data: [], error: null }).then(onFulfilled);
  return chain;
}

const insertedRows: Record<string, unknown[]> = {};

function mockDb(clients: unknown[], pausedIds: string[] = []) {
  insertedRows.notification_log = [];
  const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  fromMock.from.mockImplementation((table: string) => {
    if (table === "plan_pauses") {
      return makeChain({
        data: pausedIds.map((id) => ({ client_id: id })),
        error: null,
      }, table);
    }
    if (table === "clients") {
      return makeChain({ data: clients, error: null }, table);
    }
    if (table === "notification_log" || table === "bot_logs") {
      return makeChain(null, table);
    }
    throw new Error(`Unexpected table: ${table}`);
  });
}

const CLIENT_IN_WINDOW = {
  id: "client-1",
  telegram_id: 111,
  timezone: "Europe/Moscow",
  language: "ru",
  name: "Иван",
  access_end_date: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(),
};

const PAUSED_CLIENT = {
  ...CLIENT_IN_WINDOW,
  id: "client-2",
  telegram_id: 222,
};

function makeBot() {
  return {
    api: { sendMessage: vi.fn().mockResolvedValue({}) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(markAsSent).mockResolvedValue("sent");
});

describe("accessExpiryWindow", () => {
  it("окно [now+5д, now+6д)", () => {
    const now = new Date("2026-08-22T12:00:00.000Z");
    const { fromIso, toIso } = accessExpiryWindow(now);
    expect(fromIso).toBe("2026-08-27T12:00:00.000Z");
    expect(toIso).toBe("2026-08-28T12:00:00.000Z");
  });
});

describe("formatExpiryDate / buildAccessExpiryMessage", () => {
  it("форматирует дату по языку и таймзоне клиента", () => {
    const iso = "2026-08-27T21:00:00.000Z"; // в UTC+3 это 28 августа
    expect(formatExpiryDate(iso, "ru")).toMatch(/августа/);
    expect(formatExpiryDate(iso, "en")).toMatch(/August/);
    // tz учитывается: UTC+10 сдвигает дату с 27-го на 28-е
    const inTz = formatExpiryDate(iso, "ru", "Australia/Brisbane");
    expect(inTz).toBe("28 августа");
    expect(formatExpiryDate(iso, "ru", "UTC")).toBe("27 августа");
  });

  it("сообщение содержит имя и дату (ru/en)", () => {
    const ru = buildAccessExpiryMessage("Иван", "2026-08-27T12:00:00.000Z", "ru");
    expect(ru).toContain("Иван");
    expect(ru).toContain("августа");
    const en = buildAccessExpiryMessage("John", "2026-08-27T12:00:00.000Z", "en");
    expect(en).toContain("John");
    expect(en.toLowerCase()).toContain("august");
  });

  it("без имени - дефолтное обращение", () => {
    const msg = buildAccessExpiryMessage(null, "2026-08-27T12:00:00.000Z", "ru");
    expect(msg.length).toBeGreaterThan(0);
  });
});

describe("runAccessExpiryReminder", () => {
  it("отправляет напоминание один раз и пишет notification_log", async () => {
    mockDb([CLIENT_IN_WINDOW]);
    const bot = makeBot();

    await runAccessExpiryReminder(bot);

    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(markAsSent).toHaveBeenCalledWith(
      `access_expiring:${CLIENT_IN_WINDOW.id}:${CLIENT_IN_WINDOW.access_end_date}`,
      30 * 24,
    );
    // payload записи в notification_log
    expect(insertedRows.notification_log).toEqual([
      {
        client_id: CLIENT_IN_WINDOW.id,
        type: "access_expiring",
        status: "sent",
        sent_at: expect.any(String),
        metadata: { access_end_date: CLIENT_IN_WINDOW.access_end_date },
      },
    ]);
    expect(deleteDedup).not.toHaveBeenCalled();
  });

  it("дедуп: повторный вызов runAccessExpiryReminder не шлёт второй раз", async () => {
    mockDb([CLIENT_IN_WINDOW]);
    const bot = makeBot();

    await runAccessExpiryReminder(bot);
    vi.mocked(markAsSent).mockResolvedValue("duplicate");
    bot.api.sendMessage.mockClear();
    await runAccessExpiryReminder(bot);

    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });

  it("пропускает клиентов на активной паузе", async () => {
    mockDb([PAUSED_CLIENT], [PAUSED_CLIENT.id]);
    const bot = makeBot();

    await runAccessExpiryReminder(bot);

    expect(bot.api.sendMessage).not.toHaveBeenCalled();
    expect(markAsSent).not.toHaveBeenCalled();
  });

  it("перманентная ошибка Telegram (403) сохраняет дедуп-ключ", async () => {
    mockDb([CLIENT_IN_WINDOW]);
    const bot = makeBot();
    bot.api.sendMessage.mockRejectedValue(
      Object.assign(new Error("Forbidden: bot blocked"), { error_code: 403 }),
    );

    await runAccessExpiryReminder(bot);

    expect(deleteDedup).not.toHaveBeenCalled();
  });

  it("транзиентная ошибка снимает дедуп-ключ для ретрая", async () => {
    mockDb([CLIENT_IN_WINDOW]);
    const bot = makeBot();
    bot.api.sendMessage.mockRejectedValue(
      Object.assign(new Error("Network error"), { error_code: undefined }),
    );

    await runAccessExpiryReminder(bot);

    expect(deleteDedup).toHaveBeenCalledWith(
      `access_expiring:${CLIENT_IN_WINDOW.id}:${CLIENT_IN_WINDOW.access_end_date}`,
    );
  });

  it("клиенты вне окна не обрабатываются вовсе", async () => {
    mockDb([]);
    const bot = makeBot();

    await runAccessExpiryReminder(bot);

    expect(bot.api.sendMessage).not.toHaveBeenCalled();
    expect(markAsSent).not.toHaveBeenCalled();
  });
});
