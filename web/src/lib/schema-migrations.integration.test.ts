import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { dbQuery, resetDb } from "@/test/integration/db";

const cleanupSqlPath = path.resolve(
  process.cwd(),
  "../supabase/migrations/20261120010000_legacy_data_cleanup.sql",
);

function seedLegacyData(): void {
  const clientId = randomUUID();
  const revokedClientId = randomUUID();
  const expiredClientId = randomUUID();
  const liveTokenClientId = randomUUID();

  dbQuery(`
    INSERT INTO public.clients (id, name, status) VALUES
      ('${clientId}', 'Cleanup test', 'active'),
      ('${revokedClientId}', 'Revoked token', 'active'),
      ('${expiredClientId}', 'Expired token', 'active'),
      ('${liveTokenClientId}', 'Live token', 'active');

    INSERT INTO public.measurements (client_id, date, weight)
      VALUES ('${clientId}', CURRENT_DATE, 80.0);
    INSERT INTO public.checkins (client_id, date, wellbeing)
      VALUES ('${clientId}', CURRENT_DATE, 7);
    INSERT INTO public.photos (client_id, date, type)
      VALUES ('${clientId}', CURRENT_DATE, 'front');
    INSERT INTO public.messages (client_id, direction, text)
      VALUES ('${clientId}', 'to_coach', 'legacy');

    INSERT INTO public.purchase_requests (name, telegram_id, sub_type, created_at) VALUES
      ('old', 910001, 'program', '2026-01-01T00:00:00Z'),
      ('recent', 910002, 'program', now());

    INSERT INTO public.bot_logs (action, status, created_at) VALUES
      ('program_request', 'info', '2026-01-01T00:00:00Z'),
      ('welcome_sent', 'ok', '2026-01-01T00:00:00Z'),
      ('welcome_sent', 'ok', now() - interval '6 days'),
      ('program_request', 'info', now());

    INSERT INTO public.client_tokens (client_id, token, expires_at, revoked_at) VALUES
      ('${revokedClientId}', 'tokrevoked1', now() + interval '30 days', now()),
      ('${expiredClientId}', 'tokexpired1', now() - interval '1 day', NULL),
      ('${liveTokenClientId}', 'toklive001', now() + interval '30 days', NULL);
  `);
}

beforeEach(() => {
  resetDb();
});

describe("schema migrations on real data", () => {
  it("drops the heart_rate column from workout_logs", () => {
    expect(
      dbQuery(`
        SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'workout_logs'
          AND column_name = 'heart_rate'
      `),
    ).toBe("0");
  });

  it("has the subscription, period and token integrity indexes", () => {
    expect(
      dbQuery(`
        SELECT count(*) FROM pg_indexes
        WHERE schemaname = 'public' AND indexname IN (
          'idx_subscriptions_one_live',
          'idx_client_program_periods_one_active',
          'idx_subscription_payments_period',
          'client_tokens_token_hash_key',
          'client_tokens_one_active_per_client'
        )
      `),
    ).toBe("5");
  });

  it("keeps token and bot logs readable only by service_role", () => {
    expect(
      dbQuery(`
        SELECT
          (
            has_table_privilege('anon', 'public.client_tokens', 'SELECT')::int::text ||
            has_table_privilege('authenticated', 'public.client_tokens', 'SELECT')::int::text ||
            has_table_privilege('service_role', 'public.client_tokens', 'SELECT')::int::text
          ) || '|' ||
          (
            has_table_privilege('anon', 'public.bot_logs', 'SELECT')::int::text ||
            has_table_privilege('authenticated', 'public.bot_logs', 'SELECT')::int::text ||
            has_table_privilege('service_role', 'public.bot_logs', 'SELECT')::int::text
          )
      `),
    ).toBe("001|001");
  });

  it("records all subscription, P0, health and cleanup migrations", () => {
    expect(
      dbQuery(`
        SELECT count(*) FROM supabase_migrations.schema_migrations
        WHERE version IN (
          '20261031000000', '20261031000100', '20261031000200', '20261031000400',
          '20261111000000', '20261111000100', '20261111000200', '20261111000300',
          '20261111000400', '20261111000500', '20261111000600',
          '20261118000000', '20261118010000', '20261120010000'
        )
      `),
    ).toBe("14");
  });

  it("legacy cleanup removes health data, old requests and stale tokens but keeps the welcome window", () => {
    seedLegacyData();
    dbQuery(readFileSync(cleanupSqlPath, "utf8"));

    expect(
      dbQuery(`
        SELECT
          (SELECT count(*) FROM public.measurements) || '|' ||
          (SELECT count(*) FROM public.checkins) || '|' ||
          (SELECT count(*) FROM public.photos) || '|' ||
          (SELECT count(*) FROM public.messages) || '|' ||
          (SELECT count(*) FROM public.purchase_requests) || '|' ||
          (SELECT count(*) FROM public.bot_logs) || '|' ||
          (SELECT count(*) FROM public.client_tokens)
      `),
    ).toBe("0|0|0|0|1|2|1");

    expect(
      dbQuery(`
        SELECT action || ':' || count(*) FROM public.bot_logs
        GROUP BY action ORDER BY action
      `),
    ).toBe("program_request:1\nwelcome_sent:1");
  });
});
