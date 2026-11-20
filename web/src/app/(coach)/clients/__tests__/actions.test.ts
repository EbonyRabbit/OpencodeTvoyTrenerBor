import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/dal", () => ({
  verifySession: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { verifySession } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createClient } from "../actions";

const COACH_ID = "22222222-2222-2222-2222-222222222222";

function mockAuthed() {
  (verifySession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    profile: { id: COACH_ID, role: "coach" },
  });
}

function mockInsertFlow(opts: { insertedId?: string; insertError?: unknown }) {
  const calls: Array<{ op: string; payload?: unknown }> = [];
  const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  fake.from.mockImplementation((table: string) => {
    if (table === "clients") {
      return {
        insert: (payload: unknown) => {
          calls.push({ op: "insert", payload });
          return Promise.resolve({ error: opts.insertError ?? null });
        },
      };
    }
    return {};
  });
  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthed();
});

describe("createClient", () => {
  it("rejects missing consent", async () => {
    mockInsertFlow({});
    const result = await createClient({
      username: "@ivan",
      language: "ru",
      timezone: "UTC",
      payment_status: "pending",
      consent_given: false,
    });
    expect(result.error).toBe(
      "Необходимо согласие клиента на обработку персональных данных",
    );
  });

  it("rejects invalid username", async () => {
    mockInsertFlow({});
    const result = await createClient({
      username: "ab",
      language: "ru",
      timezone: "UTC",
      payment_status: "pending",
      consent_given: true,
    });
    expect(result.error).toBe("Укажите Telegram username (например, @username).");
  });

  it("saves normalized @username and no legacy identity fields", async () => {
    const calls = mockInsertFlow({ insertedId: "client-1" });
    const result = await createClient({
      username: "  @Ivan_User  ",
      language: "ru",
      timezone: "UTC",
      payment_status: "pending",
      consent_given: true,
    });
    const insert = calls.find((c) => c.op === "insert")?.payload as Record<
      string,
      string
    >;
    expect(result.id).toBe(insert.id);
    expect(insert.name).toBe("@ivan_user");
    expect(insert.telegram_id).toBeNull();
    expect(Object.keys(insert)).not.toEqual(
      expect.arrayContaining(["contact", "first_name", "last_name"]),
    );
  });

  it("assigns stable fallback name from client id when username empty", async () => {
    const calls = mockInsertFlow({});
    const result = await createClient({
      username: "",
      language: "ru",
      timezone: "UTC",
      payment_status: "pending",
      consent_given: true,
    });
    const insert = calls.find((c) => c.op === "insert")?.payload as Record<
      string,
      string
    >;
    expect(result.id).toBe(insert.id);
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(insert.name).toBe(
      `Клиент #${insert.id.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase()}`,
    );
  });
});
