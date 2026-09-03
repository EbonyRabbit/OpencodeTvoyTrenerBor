import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { supabaseAdmin } from "../../lib/supabase-admin.js";
import { markAsSent, deleteDedup } from "../dedup.js";
import { runWelcomeFollowup } from "../welcome-followup.js";

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

function makeBot() {
  return { api: { sendMessage: vi.fn().mockResolvedValue({}) } } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(markAsSent).mockResolvedValue("sent");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-03T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runWelcomeFollowup", () => {
  it("sends followup1 after 24h", async () => {
    const welcomeTime = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    const bot = makeBot();
    const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    let botLogsCalls = 0;
    fromMock.from.mockImplementation((table: string) => {
      const chain: any = {};
      for (const m of ["select", "eq", "in", "lte", "order", "limit", "insert"]) chain[m] = (..._a: any[]) => chain;
      chain.then = (cb: any) => {
        if (table === "bot_logs") {
          botLogsCalls++;
          if (botLogsCalls === 1) return Promise.resolve({ data: [{ telegram_id: 111, created_at: welcomeTime, details: "channel_grow" }], error: null }).then(cb);
          return Promise.resolve({ data: [], error: null }).then(cb);
        }
        if (table === "purchase_requests") return Promise.resolve({ data: [], error: null }).then(cb);
        if (table === "clients") return Promise.resolve({ data: [], error: null }).then(cb);
        return Promise.resolve({ data: [], error: null }).then(cb);
      };
      return chain;
    });

    await runWelcomeFollowup(bot);
    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(markAsSent).toHaveBeenCalledWith("welcome_followup:111:1", 7 * 24);
  });

  it("does not send followup1 before 24h", async () => {
    const bot = makeBot();
    const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    fromMock.from.mockImplementation((table: string) => {
      const chain: any = {};
      for (const m of ["select", "eq", "lte", "order", "limit"]) chain[m] = () => chain;
      chain.then = (cb: any) => Promise.resolve({ data: [], error: null }).then(cb);
      return chain;
    });
    await runWelcomeFollowup(bot);
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });

  it("sends followup2 after 72h when followup1 exists and not paid", async () => {
    const welcomeTime = new Date(Date.now() - 80 * 3600 * 1000).toISOString();
    const bot = makeBot();
    let botLogsCalls = 0;
    const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    fromMock.from.mockImplementation((table: string) => {
      const chain: any = {};
      for (const m of ["select", "eq", "in", "lte", "order", "limit", "insert"]) chain[m] = (..._a: any[]) => chain;
      chain.then = (cb: any) => {
        if (table === "bot_logs") {
          botLogsCalls++;
          if (botLogsCalls === 1) return Promise.resolve({ data: [{ telegram_id: 444, created_at: welcomeTime, details: "channel_grow" }], error: null }).then(cb);
          if (botLogsCalls === 2) return Promise.resolve({ data: [{ telegram_id: 444, action: "welcome_followup1" }], error: null }).then(cb);
          return Promise.resolve({ data: [], error: null }).then(cb);
        }
        if (table === "purchase_requests") return Promise.resolve({ data: [], error: null }).then(cb);
        if (table === "clients") return Promise.resolve({ data: [], error: null }).then(cb);
        return Promise.resolve({ data: [], error: null }).then(cb);
      };
      return chain;
    });

    await runWelcomeFollowup(bot);
    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(markAsSent).toHaveBeenCalledWith("welcome_followup:444:2", 7 * 24);
  });

  it("skips followup2 if paid", async () => {
    const welcomeTime = new Date(Date.now() - 80 * 3600 * 1000).toISOString();
    const bot = makeBot();
    let callIdx = 0;
    const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    fromMock.from.mockImplementation((table: string) => {
      const chain: any = {};
      for (const m of ["select", "eq", "in", "lte", "order", "limit", "insert"]) chain[m] = () => chain;
      chain.then = (cb: any) => {
        callIdx++;
        if (table === "bot_logs" && callIdx === 1) return Promise.resolve({ data: [{ telegram_id: 222, created_at: welcomeTime, details: "channel_grow" }], error: null }).then(cb);
        if (table === "bot_logs" && callIdx === 2) return Promise.resolve({ data: [{ telegram_id: 222, action: "welcome_followup1" }], error: null }).then(cb);
        if (table === "purchase_requests") return Promise.resolve({ data: [{ telegram_id: 222 }], error: null }).then(cb);
        if (table === "clients") return Promise.resolve({ data: [], error: null }).then(cb);
        return Promise.resolve({ data: [], error: null }).then(cb);
      };
      return chain;
    });
    await runWelcomeFollowup(bot);
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });

  it("does not send duplicate when dedup returns duplicate", async () => {
    vi.mocked(markAsSent).mockResolvedValueOnce("duplicate");
    const welcomeTime = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    const bot = makeBot();
    let botLogsCalls = 0;
    const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    fromMock.from.mockImplementation((table: string) => {
      const chain: any = {};
      for (const m of ["select", "eq", "in", "lte", "order", "limit", "insert"]) chain[m] = (..._a: any[]) => chain;
      chain.then = (cb: any) => {
        if (table === "bot_logs") {
          botLogsCalls++;
          if (botLogsCalls === 1) return Promise.resolve({ data: [{ telegram_id: 333, created_at: welcomeTime, details: "channel_grow" }], error: null }).then(cb);
          return Promise.resolve({ data: [], error: null }).then(cb);
        }
        if (table === "purchase_requests") return Promise.resolve({ data: [], error: null }).then(cb);
        if (table === "clients") return Promise.resolve({ data: [], error: null }).then(cb);
        return Promise.resolve({ data: [], error: null }).then(cb);
      };
      return chain;
    });

    await runWelcomeFollowup(bot);
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
    expect(markAsSent).toHaveBeenCalledWith("welcome_followup:333:1", 7 * 24);
  });
});
