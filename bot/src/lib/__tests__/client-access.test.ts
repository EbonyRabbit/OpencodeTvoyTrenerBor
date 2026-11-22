import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseAdmin } from "../supabase-admin.js";
import {
  filterClientsWithAccess,
  findLiveSubscription,
  hasClientAccess,
} from "../client-access.js";
import type { Client } from "../clients.js";

vi.mock("../supabase-admin.js", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

type Result = { data: unknown; error: { message: string } | null };

function makeChain(result: Result) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "limit"]) {
    chain[method] = () => chain;
  }
  chain.maybeSingle = () => Promise.resolve(result);
  chain.then = (
    onFulfilled: (value: Result) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

function mockSubscriptions(result: Result, pauseResult: Result = { data: null, error: null }) {
  const from = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  from.from.mockImplementation((table: string) => {
    if (table === "plan_pauses") return makeChain(pauseResult);
    if (table === "subscriptions") return makeChain(result);
    throw new Error(`Unexpected table: ${table}`);
  });
}

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: "client-1",
    status: "active",
    payment_status: "paid",
    access_end_date: null,
    ...overrides,
  } as Client;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("client access", () => {
  it("finds a live subscription", async () => {
    mockSubscriptions({ data: { id: "sub-1" }, error: null });
    expect(await findLiveSubscription("client-1")).toBe(true);
  });

  it("fails closed when the subscription check errors", async () => {
    mockSubscriptions({ data: null, error: { message: "db down" } });
    await expect(findLiveSubscription("client-1")).rejects.toThrow("db down");
  });

  it("lets a pending client in when a live subscription exists", async () => {
    mockSubscriptions({ data: { id: "sub-1" }, error: null });
    expect(await hasClientAccess(makeClient({ payment_status: "pending" }))).toBe(true);
  });

  it("blocks a pending client without a live subscription", async () => {
    mockSubscriptions({ data: null, error: null });
    expect(await hasClientAccess(makeClient({ payment_status: "pending" }))).toBe(false);
  });

  it("does not query subscriptions for paid clients with valid access", async () => {
    const from = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    expect(await hasClientAccess(makeClient())).toBe(true);
    expect(from.from).not.toHaveBeenCalled();
  });

  it("blocks a paid client with expired access and no live subscription", async () => {
    mockSubscriptions({ data: null, error: null });
    const client = makeClient({ access_end_date: "2026-11-01T00:00:00.000Z" });

    expect(await hasClientAccess(client, {}, new Date("2026-11-22T12:00:00.000Z"))).toBe(false);
  });

  it("lets an expired paid client in when a live subscription exists", async () => {
    mockSubscriptions({ data: { id: "sub-1" }, error: null });
    const client = makeClient({ access_end_date: "2026-11-01T00:00:00.000Z" });

    expect(await hasClientAccess(client, {}, new Date("2026-11-22T12:00:00.000Z"))).toBe(true);
  });

  it("keeps access for a paused client with expired paid access", async () => {
    const from = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    const client = makeClient({ access_end_date: "2026-11-01T00:00:00.000Z" });

    expect(
      await hasClientAccess(client, { allowExpiredPaid: true }, new Date("2026-11-22T12:00:00.000Z")),
    ).toBe(true);
    expect(from.from).not.toHaveBeenCalled();
  });

  it("lets a paused client with expired paid access in without an override", async () => {
    mockSubscriptions(
      { data: null, error: null },
      { data: { id: "pause-1" }, error: null },
    );
    const client = makeClient({ access_end_date: "2026-11-01T00:00:00.000Z" });

    expect(await hasClientAccess(client, {}, new Date("2026-11-22T12:00:00.000Z"))).toBe(true);
  });

  it("filters cron recipients by access", async () => {
    mockSubscriptions({ data: [{ client_id: "client-1" }], error: null });
    const now = new Date("2026-11-22T12:00:00.000Z");
    const clients = [
      makeClient({ id: "client-1", payment_status: "pending", access_end_date: null }),
      makeClient({ id: "client-2", payment_status: "paid", access_end_date: null }),
      makeClient({
        id: "client-3",
        payment_status: "paid",
        access_end_date: "2026-11-01T00:00:00.000Z",
      }),
      makeClient({ id: "client-4", status: "inactive" }),
    ];

    const result = await filterClientsWithAccess(clients, now);
    expect(result.map((client) => client.id)).toEqual(["client-1", "client-2"]);
  });

  it("keeps paid recipients when the bulk subscription check errors", async () => {
    mockSubscriptions({ data: null, error: { message: "db down" } });
    const now = new Date("2026-11-22T12:00:00.000Z");
    const clients = [
      makeClient({ id: "client-1", payment_status: "pending" }),
      makeClient({ id: "client-2", payment_status: "paid", access_end_date: null }),
      makeClient({
        id: "client-3",
        payment_status: "paid",
        access_end_date: "2026-11-23T00:00:00.000Z",
      }),
    ];

    const result = await filterClientsWithAccess(clients, now);
    expect(result.map((client) => client.id)).toEqual(["client-2", "client-3"]);
  });
});
