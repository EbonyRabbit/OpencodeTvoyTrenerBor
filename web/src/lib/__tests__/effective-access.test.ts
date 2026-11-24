import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  getEffectiveAccess,
  type EffectiveAccessSubscription,
} from "../effective-access";
import { getEffectiveAccessForClient } from "../effective-access-server";

const NOW = new Date("2026-11-24T12:00:00.000Z");
const CLIENT_ID = "11111111-2222-3333-4444-555555555555";

function subscription(
  overrides: Partial<EffectiveAccessSubscription> = {},
): EffectiveAccessSubscription {
  return {
    status: "active",
    current_period_end: "2026-12-24T12:00:00.000Z",
    cancel_at_period_end: false,
    ...overrides,
  };
}

type ServerDbState = {
  subscription?: Record<string, unknown> | null;
  subscriptionError?: { message: string } | null;
  pause?: Record<string, unknown> | null;
  pauseError?: { message: string } | null;
};

function mockServerDb(state: ServerDbState = {}) {
  const chains: Record<
    string,
    { eq: ReturnType<typeof vi.fn>; in: ReturnType<typeof vi.fn> }
  > = {};
  const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  fake.from.mockImplementation((table: string) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      maybeSingle: vi.fn(() => {
        if (table === "subscriptions") {
          return Promise.resolve({
            data: state.subscription ?? null,
            error: state.subscriptionError ?? null,
          });
        }
        if (table === "plan_pauses") {
          return Promise.resolve({
            data: state.pause ?? null,
            error: state.pauseError ?? null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    };
    chains[table] = chain;
    return chain;
  });
  return chains;
}

describe("getEffectiveAccess", () => {
  it("uses a live subscription when payment_status is pending", () => {
    const result = getEffectiveAccess(
      {
        status: "active",
        payment_status: "pending",
        access_end_date: "2026-11-01T12:00:00.000Z",
      },
      subscription(),
      NOW,
    );

    expect(result).toEqual({
      active: true,
      source: "subscription",
      endDate: "2026-12-24T12:00:00.000Z",
      isExpired: false,
      showPaymentWarning: false,
      cancelAtPeriodEnd: false,
      subscriptionStatus: "active",
      paused: false,
    });
  });

  it("treats past_due as live and exposes scheduled cancellation", () => {
    const result = getEffectiveAccess(
      {
        status: "active",
        payment_status: "paid",
        access_end_date: "2026-12-24T12:00:00.000Z",
      },
      subscription({ status: "past_due", cancel_at_period_end: true }),
      NOW,
    );

    expect(result.active).toBe(true);
    expect(result.subscriptionStatus).toBe("past_due");
    expect(result.cancelAtPeriodEnd).toBe(true);
    expect(result.endDate).toBe("2026-12-24T12:00:00.000Z");
  });

  it("does not grant access when the client status is not active", () => {
    const result = getEffectiveAccess(
      {
        status: "inactive",
        payment_status: "paid",
        access_end_date: "2026-12-24T12:00:00.000Z",
      },
      subscription(),
      NOW,
    );

    expect(result.active).toBe(false);
    expect(result.source).toBe("subscription");
    expect(result.showPaymentWarning).toBe(false);
  });

  it("keeps the expired alert for a stale access_expired status with a live subscription", () => {
    const result = getEffectiveAccess(
      {
        status: "access_expired",
        payment_status: "paid",
        access_end_date: "2026-11-01T12:00:00.000Z",
      },
      subscription(),
      NOW,
    );

    expect(result.active).toBe(false);
    expect(result.source).toBe("subscription");
    expect(result.isExpired).toBe(true);
    expect(result.showPaymentWarning).toBe(false);
  });

  it("accepts legacy paid clients with a future access_end_date", () => {
    const result = getEffectiveAccess(
      {
        status: "active",
        payment_status: "paid",
        access_end_date: "2026-12-10T12:00:00.000Z",
      },
      null,
      NOW,
    );

    expect(result.active).toBe(true);
    expect(result.source).toBe("legacy_paid");
    expect(result.endDate).toBe("2026-12-10T12:00:00.000Z");
    expect(result.isExpired).toBe(false);
  });

  it("accepts legacy paid clients without an access_end_date", () => {
    const result = getEffectiveAccess(
      { status: "active", payment_status: "paid", access_end_date: null },
      null,
      NOW,
    );

    expect(result.active).toBe(true);
    expect(result.source).toBe("legacy_paid");
    expect(result.endDate).toBeNull();
  });

  it("marks legacy paid clients as expired after access_end_date", () => {
    const result = getEffectiveAccess(
      {
        status: "active",
        payment_status: "paid",
        access_end_date: "2026-11-20T12:00:00.000Z",
      },
      null,
      NOW,
    );

    expect(result.active).toBe(false);
    expect(result.isExpired).toBe(true);
    expect(result.showPaymentWarning).toBe(false);
  });

  it("fails closed on a malformed legacy access_end_date", () => {
    const result = getEffectiveAccess(
      {
        status: "active",
        payment_status: "paid",
        access_end_date: "not-a-date",
      },
      null,
      NOW,
    );

    expect(result.active).toBe(false);
    expect(result.isExpired).toBe(true);
  });

  it("keeps access for a legacy paid client during an active pause", () => {
    const result = getEffectiveAccess(
      {
        status: "active",
        payment_status: "paid",
        access_end_date: "2026-11-20T12:00:00.000Z",
      },
      null,
      NOW,
      true,
    );

    expect(result.active).toBe(true);
    expect(result.paused).toBe(true);
    expect(result.isExpired).toBe(false);
  });

  it("keeps the payment warning for pending clients without a live subscription", () => {
    const result = getEffectiveAccess(
      {
        status: "active",
        payment_status: "pending",
        access_end_date: null,
      },
      null,
      NOW,
    );

    expect(result.active).toBe(false);
    expect(result.showPaymentWarning).toBe(true);
  });

  it("ignores cancelled subscriptions and falls back to legacy access", () => {
    const result = getEffectiveAccess(
      {
        status: "active",
        payment_status: "paid",
        access_end_date: "2026-12-10T12:00:00.000Z",
      },
      subscription({ status: "cancelled" }),
      NOW,
    );

    expect(result.active).toBe(true);
    expect(result.source).toBe("legacy_paid");
    expect(result.subscriptionStatus).toBeNull();
  });
});

describe("getEffectiveAccessForClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails closed for a pending client when the subscription lookup errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const chains = mockServerDb({ subscriptionError: { message: "db down" } });

    const result = await getEffectiveAccessForClient(
      {
        id: CLIENT_ID,
        status: "active",
        payment_status: "pending",
        access_end_date: null,
      },
      NOW,
    );

    expect(result.active).toBe(false);
    expect(chains.subscriptions.in).toHaveBeenCalledWith("status", [
      "active",
      "past_due",
    ]);
    errorSpy.mockRestore();
  });

  it("falls back to legacy paid access when the subscription lookup errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockServerDb({ subscriptionError: { message: "db down" } });

    const result = await getEffectiveAccessForClient(
      {
        id: CLIENT_ID,
        status: "active",
        payment_status: "paid",
        access_end_date: "2026-12-10T12:00:00.000Z",
      },
      NOW,
    );

    expect(result.active).toBe(true);
    expect(result.source).toBe("legacy_paid");
    errorSpy.mockRestore();
  });

  it("loads an active pause for legacy paid clients", async () => {
    const chains = mockServerDb({ pause: { id: "pause-id" } });

    const result = await getEffectiveAccessForClient(
      {
        id: CLIENT_ID,
        status: "active",
        payment_status: "paid",
        access_end_date: "2026-11-20T12:00:00.000Z",
      },
      NOW,
    );

    expect(result.active).toBe(true);
    expect(result.paused).toBe(true);
    expect(chains.plan_pauses.eq).toHaveBeenCalledWith("status", "active");
  });

  it("fails closed when only the pause lookup errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockServerDb({ pauseError: { message: "db down" } });

    const result = await getEffectiveAccessForClient(
      {
        id: CLIENT_ID,
        status: "active",
        payment_status: "paid",
        access_end_date: "2026-11-20T12:00:00.000Z",
      },
      NOW,
    );

    expect(result.active).toBe(false);
    expect(result.paused).toBe(false);
    errorSpy.mockRestore();
  });
});
