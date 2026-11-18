import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("../../config.js", () => ({
  config: {
    telegram: { botToken: "test-token", webhookSecret: "test-secret" },
    supabase: { url: "http://localhost:54321", serviceRoleKey: "test-key" },
    coachChatId: 12345,
    clientPortalUrl: "https://portal.example.com",
    nodeEnv: "test",
    port: 3001,
    webhookPath: "/webhook",
    publicUrl: "",
  },
}));

const fromMock = vi.fn();

vi.mock("../../lib/supabase-admin.js", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => fromMock(...args) },
}));

vi.mock("../../state/machine.js", () => ({
  getState: vi.fn().mockResolvedValue({ action: "chat", step: "active", data: { client_id: "client-1" } }),
  setState: vi.fn().mockResolvedValue(undefined),
  clearState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/clients.js", () => ({
  findClientByTelegramId: vi.fn().mockResolvedValue({ id: "client-1", name: "Test", telegram_id: 555 }),
}));

vi.mock("../../cron/dedup.js", () => ({
  markAsSent: vi.fn().mockResolvedValue("sent"),
  deleteDedup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../cron/logger.js", () => ({
  logBotEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/workout-utils.js", () => ({
  getTodayDateStr: () => "2026-11-18",
  getTodayDayOfMonth: () => 18,
  parseTimeRounded: (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return { hour: h ?? 0, minute: m ?? 0 };
  },
}));

vi.mock("../../bot.js", () => ({
  bot: { api: { sendMessage: vi.fn().mockResolvedValue(undefined) } },
}));

function readSrc(rel: string): string {
  return readFileSync(path.resolve(__dirname, "../../", rel), "utf8");
}

describe("health data removal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not register /measure, /measurements, /checkin commands", () => {
    const botSrc = readSrc("bot.ts");
    expect(botSrc).not.toMatch(/\.command\("measure"/);
    expect(botSrc).not.toMatch(/\.command\("measurements"/);
    expect(botSrc).not.toMatch(/\.command\("checkin"/);
  });

  it("measurement-reminder does not read measurements table", async () => {
    const clientsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const pausesQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    fromMock.mockImplementation((table: string) => {
      if (table === "clients") return clientsQuery;
      if (table === "plan_pauses") return pausesQuery;
      throw new Error(`unexpected table ${table}`);
    });

    const { runMeasurementReminder } = await import("../../cron/measurement-reminder.js");
    await runMeasurementReminder({ api: { sendMessage: vi.fn() } } as never);

    const tables = fromMock.mock.calls.map((c) => c[0]);
    expect(tables).toContain("clients");
    expect(tables).not.toContain("measurements");
  });

  it("chat forwarding does not write to messages table", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "clients") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: "client-1", telegram_id: 777, language: "ru" } }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const { handleFreeTextMessage, handleCoachIncoming } = await import("../chat.js");

    await handleFreeTextMessage({
      from: { id: 555 },
      message: { text: "hello" },
      language: "ru",
      reply: vi.fn().mockResolvedValue(undefined),
    } as never);

    await handleCoachIncoming({
      from: { id: 12345 },
      message: { text: "reply" },
      language: "ru",
      reply: vi.fn().mockResolvedValue(undefined),
    } as never);

    const tables = fromMock.mock.calls.map((c) => c[0]);
    expect(tables).toContain("clients");
    expect(tables).not.toContain("messages");
  });
});
