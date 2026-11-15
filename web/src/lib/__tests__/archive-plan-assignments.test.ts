import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import { archivePlanAssignments } from "../activate-purchase";

type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, unknown, unknown]> };

function chain(
  table: string,
  op: string,
  calls: Call[],
  result: { error: { message: string } | null } = { error: null },
) {
  const builder: Record<string, unknown> = {
    update: vi.fn((payload: unknown) => {
      calls.push({ table, op: "update", payload, filters: [] });
      return builder;
    }),
    eq: vi.fn((col: string, val: unknown) => {
      calls[calls.length - 1]?.filters.push(["eq", col, val]);
      return builder;
    }),
    neq: vi.fn((col: string, val: unknown) => {
      calls[calls.length - 1]?.filters.push(["neq", col, val]);
      return builder;
    }),
    in: vi.fn((col: string, val: unknown) => {
      calls[calls.length - 1]?.filters.push(["in", col, val]);
      return builder;
    }),
    is: vi.fn((col: string, val: unknown) => {
      calls[calls.length - 1]?.filters.push(["is", col, val]);
      return builder;
    }),
    then: (resolve: (v: { error: { message: string } | null }) => void) =>
      resolve(result),
  };
  return builder;
}

const CLIENT_ID = "11111111-2222-3333-4444-555555555555";

describe("archivePlanAssignments", () => {
  let calls: Call[];

  beforeEach(() => {
    calls = [];
    mocks.from.mockClear();
    mocks.from.mockImplementation((table: string) => {
      if (table === "program_schedule") return chain(table, "update", calls);
      if (table === "plan_pauses") return chain(table, "update", calls);
      if (table === "client_program_periods") return chain(table, "update", calls);
      throw new Error(`Unexpected table: ${table}`);
    });
  });

  it("archives schedule and closes active and resuming pauses", async () => {
    const result = await archivePlanAssignments(CLIENT_ID);

    expect(result.error).toBeUndefined();
    const scheduleCall = calls.find((c) => c.table === "program_schedule");
    expect(scheduleCall?.payload).toEqual({ status: "archived" });
    expect(scheduleCall?.filters).toContainEqual(["eq", "client_id", CLIENT_ID]);
    expect(scheduleCall?.filters).toContainEqual(["neq", "status", "archived"]);

    const openPauses = calls.filter((c) => c.table === "plan_pauses")[0];
    expect(openPauses?.payload).toMatchObject({ status: "completed", pause_end: expect.any(String) });
    expect(openPauses?.filters).toContainEqual(["in", "status", ["active", "resuming"]]);
    expect(openPauses?.filters).toContainEqual(["is", "pause_end", null]);

    const remainingPauses = calls.filter((c) => c.table === "plan_pauses")[1];
    expect(remainingPauses?.payload).toEqual({ status: "completed" });
    expect(remainingPauses?.filters).toContainEqual(["in", "status", ["active", "resuming"]]);
  });

  it("returns an error when schedule archive fails", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "program_schedule") {
        return chain(table, "update", calls, { error: { message: "db down" } });
      }
      if (table === "plan_pauses") return chain(table, "update", calls);
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await archivePlanAssignments(CLIENT_ID);
    expect(result.error).toBe("Не удалось архивировать расписание.");
  });

  it("returns an error when pause closure fails", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "program_schedule") return chain(table, "update", calls);
      if (table === "plan_pauses") {
        return chain(table, "update", calls, { error: { message: "db down" } });
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await archivePlanAssignments(CLIENT_ID);
    expect(result.error).toBe("Не удалось закрыть паузы плана.");
  });
});
