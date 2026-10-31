import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "grammy";
import { supabaseAdmin } from "../../lib/supabase-admin.js";
import { runWelcomeFollowup } from "../welcome-followup.js";
import type { MyContext } from "../../bot.js";
import { resetDb, runTestSql } from "../../test/integration/db.js";

function makeBot() {
  return {
    api: { sendMessage: vi.fn().mockResolvedValue({}) },
  } as unknown as Bot<MyContext>;
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

async function seedWelcome(
  telegramId: number,
  hours: number,
  details = "channel_grow",
) {
  const { error } = await supabaseAdmin.from("bot_logs").insert({
    action: "welcome_sent",
    telegram_id: telegramId,
    status: "ok",
    details,
    created_at: hoursAgo(hours),
  });
  if (error) throw error;
}

beforeEach(() => {
  resetDb();
  runTestSql(`
    DROP TRIGGER IF EXISTS reject_welcome_followup_log ON public.bot_logs;
    DROP FUNCTION IF EXISTS public.reject_welcome_followup_log();
  `);
  vi.clearAllMocks();
});

describe("runWelcomeFollowup on real data", () => {
  it("sends followup1 after 24 hours and persists the sent marker", async () => {
    await seedWelcome(111, 25);
    const bot = makeBot();

    await runWelcomeFollowup(bot);

    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      111,
      expect.any(String),
    );

    const { data: logs } = await supabaseAdmin
      .from("bot_logs")
      .select("action, telegram_id, details")
      .eq("action", "welcome_followup1");
    expect(logs).toEqual([
      expect.objectContaining({
        action: "welcome_followup1",
        telegram_id: 111,
        details: "channel_grow",
      }),
    ]);

    const { data: dedup } = await supabaseAdmin
      .from("bot_dedup")
      .select("key")
      .eq("key", "welcome_followup:base:111:1");
    expect(dedup).toHaveLength(1);
  });

  it("processes welcomes beyond the first 200-row page", async () => {
    for (let i = 0; i < 201; i += 1) {
      await seedWelcome(10_000 + i, 25);
    }
    const bot = makeBot();

    await runWelcomeFollowup(bot);

    expect(bot.api.sendMessage).toHaveBeenCalledTimes(201);
    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      10_200,
      expect.any(String),
    );
  });

  it("does not resend when the sent marker cannot be logged", async () => {
    await seedWelcome(333, 25);
    runTestSql(`
      CREATE OR REPLACE FUNCTION public.reject_welcome_followup_log()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'welcome_followup1' THEN
          RAISE EXCEPTION 'forced welcome log failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS reject_welcome_followup_log ON public.bot_logs;
      CREATE TRIGGER reject_welcome_followup_log
        BEFORE INSERT ON public.bot_logs
        FOR EACH ROW EXECUTE FUNCTION public.reject_welcome_followup_log();
    `);
    try {
      const first = makeBot();
      await runWelcomeFollowup(first);
      expect(first.api.sendMessage).toHaveBeenCalledTimes(1);

      const second = makeBot();
      await runWelcomeFollowup(second);
      expect(second.api.sendMessage).not.toHaveBeenCalled();
    } finally {
      runTestSql(`
        DROP TRIGGER IF EXISTS reject_welcome_followup_log ON public.bot_logs;
        DROP FUNCTION IF EXISTS public.reject_welcome_followup_log();
      `);
    }
  });

  it("chunks recipient lookups for more than 1000 users", async () => {
    const welcomes = Array.from({ length: 1001 }, (_, i) => ({
      action: "welcome_sent",
      telegram_id: 40_000 + i,
      status: "ok",
      details: "channel_grow",
      created_at: hoursAgo(26),
    }));
    const { error: welcomeError } = await supabaseAdmin
      .from("bot_logs")
      .insert(welcomes);
    if (welcomeError) throw welcomeError;
    const { error: followupError } = await supabaseAdmin
      .from("bot_logs")
      .insert(
        welcomes.map((w) => ({
          action: "welcome_followup1",
          telegram_id: w.telegram_id,
          status: "ok",
          details: "channel_grow",
        })),
      );
    if (followupError) throw followupError;
    await seedWelcome(42_000, 25);

    const bot = makeBot();
    await runWelcomeFollowup(bot);

    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(bot.api.sendMessage).toHaveBeenCalledWith(42_000, expect.any(String));
  });

  it("uses the latest welcome when one user spans two pages", async () => {
    for (let i = 0; i < 199; i += 1) {
      const tid = 20_000 + i;
      await seedWelcome(tid, 26);
      await supabaseAdmin.from("bot_logs").insert({
        action: "welcome_followup1",
        telegram_id: tid,
        status: "ok",
        details: "channel_grow",
      });
    }
    await seedWelcome(30_000, 26, "channel_grow");
    await seedWelcome(30_000, 25, "guide_calories");
    const bot = makeBot();

    await runWelcomeFollowup(bot);

    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(bot.api.sendMessage).toHaveBeenCalledWith(30_000, expect.any(String));
    const { data: logs } = await supabaseAdmin
      .from("bot_logs")
      .select("details")
      .eq("action", "welcome_followup1")
      .eq("telegram_id", 30_000);
    expect(logs).toEqual([{ details: "guide_calories" }]);
  });

  it("does not send followup1 before 24 hours", async () => {
    await seedWelcome(222, 23);
    const bot = makeBot();

    await runWelcomeFollowup(bot);

    expect(bot.api.sendMessage).not.toHaveBeenCalled();
    const { count } = await supabaseAdmin
      .from("bot_logs")
      .select("id", { count: "exact", head: true })
      .eq("action", "welcome_followup1");
    expect(count).toBe(0);
  });

  it("sends followup2 after 72 hours when followup1 was already sent", async () => {
    await seedWelcome(333, 80);
    await supabaseAdmin.from("bot_logs").insert({
      action: "welcome_followup1",
      telegram_id: 333,
      status: "ok",
      details: "channel_grow",
      created_at: hoursAgo(48),
    });
    const bot = makeBot();

    await runWelcomeFollowup(bot);

    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
    const { data: logs } = await supabaseAdmin
      .from("bot_logs")
      .select("action")
      .eq("action", "welcome_followup2");
    expect(logs).toHaveLength(1);
  });

  it("skips followup2 when the user has a paid request", async () => {
    await seedWelcome(444, 80);
    await supabaseAdmin.from("bot_logs").insert({
      action: "welcome_followup1",
      telegram_id: 444,
      status: "ok",
      details: "channel_grow",
    });
    const { error } = await supabaseAdmin.from("purchase_requests").insert({
      name: "Paid User",
      contact: "@paid",
      telegram_id: 444,
      status: "paid",
      sub_type: "program",
      consent_given: true,
    });
    if (error) throw error;
    const bot = makeBot();

    await runWelcomeFollowup(bot);

    expect(bot.api.sendMessage).not.toHaveBeenCalled();
    const { count } = await supabaseAdmin
      .from("bot_logs")
      .select("id", { count: "exact", head: true })
      .eq("action", "welcome_followup2");
    expect(count).toBe(0);
  });

  it("does not send twice when the dedup key already exists", async () => {
    await seedWelcome(555, 25);
    const { error } = await supabaseAdmin.from("bot_dedup").insert({
      key: "welcome_followup:base:555:1",
      expires_at: hoursAgo(-24),
    });
    if (error) throw error;
    const bot = makeBot();

    await runWelcomeFollowup(bot);

    expect(bot.api.sendMessage).not.toHaveBeenCalled();
    const { count } = await supabaseAdmin
      .from("bot_dedup")
      .select("id", { count: "exact", head: true })
      .eq("key", "welcome_followup:base:555:1");
    expect(count).toBe(1);
  });
});
