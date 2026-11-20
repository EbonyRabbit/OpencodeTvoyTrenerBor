import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientRow } from "@/lib/clients";

const mocks = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { from: mocks.mockFrom },
}));

import { lazyExpireAccess } from "../lazy-expire-access";

type ChainCall = { method: string; args: unknown[] };
type Result = { data: unknown; error: { message: string } | null };

function makeChain(result: Result) {
  const calls: ChainCall[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "limit", "update", "lt"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(result);
  chain.then = (
    onFulfilled: (value: Result) => unknown,
  ) => Promise.resolve(result).then(onFulfilled);
  return { chain, calls };
}

type DbConfig = {
  pause?: Result | null;
  subscription?: Result;
  update?: Result;
};

function mockDb(cfg: DbConfig = {}) {
  const calls: Record<string, ChainCall[]> = {};
  mocks.mockFrom.mockImplementation((table: string) => {
    const result =
      table === "plan_pauses"
        ? { data: null, error: null, ...(cfg.pause ?? {}) }
        : table === "subscriptions"
          ? { data: null, error: null, ...cfg.subscription }
          : { data: [], error: null, ...cfg.update };
    const built = makeChain(result);
    calls[table] = built.calls;
    return built.chain;
  });
  return calls;
}

function makeClient(overrides: Partial<ClientRow> = {}): ClientRow {
  return {
    id: "client-1",
    status: "active",
    access_end_date: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    ...overrides,
  } as unknown as ClientRow;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lazyExpireAccess", () => {
  it("does nothing for a future access date", async () => {
    const calls = mockDb();
    const expired = await lazyExpireAccess(
      makeClient({
        access_end_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      }),
    );

    expect(expired).toBe(false);
    expect(Object.keys(calls)).toHaveLength(0);
  });

  it("does not query subscriptions while a plan pause is active", async () => {
    const calls = mockDb({ pause: { data: { id: "pause-1" }, error: null } });

    expect(await lazyExpireAccess(makeClient())).toBe(false);
    expect(calls.subscriptions).toBeUndefined();
    expect(calls.clients).toBeUndefined();
  });

  it("keeps access for active and past_due subscriptions", async () => {
    const calls = mockDb({
      subscription: { data: { id: "sub-1" }, error: null },
    });

    expect(await lazyExpireAccess(makeClient())).toBe(false);
    expect(calls.clients).toBeUndefined();
  });

  it("uses the same conditional update guards as the bot gate", async () => {
    const calls = mockDb({
      update: { data: [{ id: "client-1" }], error: null },
    });

    expect(await lazyExpireAccess(makeClient())).toBe(true);

    const updateCalls = calls.clients ?? [];
    expect(updateCalls.find((c) => c.method === "update")?.args[0]).toEqual({
      status: "access_expired",
    });
    expect(
      updateCalls.some((c) => c.method === "eq" && c.args[0] === "id" && c.args[1] === "client-1"),
    ).toBe(true);
    expect(
      updateCalls.some((c) => c.method === "eq" && c.args[0] === "status" && c.args[1] === "active"),
    ).toBe(true);
    const lt = updateCalls.find((c) => c.method === "lt");
    expect(lt?.args[0]).toBe("access_end_date");
    expect(new Date(String(lt?.args[1])).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("returns false when a concurrent renewal wins the conditional update", async () => {
    mockDb({ update: { data: [], error: null } });

    expect(await lazyExpireAccess(makeClient())).toBe(false);
  });

  it("fails closed when the subscription lookup errors", async () => {
    const calls = mockDb({
      subscription: { data: null, error: { message: "db down" } },
    });

    expect(await lazyExpireAccess(makeClient())).toBe(false);
    expect(calls.clients).toBeUndefined();
  });
});
