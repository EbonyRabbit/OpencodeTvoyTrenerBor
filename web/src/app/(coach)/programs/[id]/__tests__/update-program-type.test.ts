import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/dal", () => ({
  verifySession: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("@/lib/plan-adjustment", () => ({
  generateSchedule: vi.fn(),
}));

import { verifySession } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { revalidatePath } from "next/cache";
import { updateProgramType } from "../actions";

const UUID = "11111111-2222-3333-4444-555555555555";

function mockProgramsTable(existing: { id: string } | null) {
  const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve({ data: existing, error: null })),
    update: vi.fn(() => chain),
    then: (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ error: null }).then(onFulfilled),
  };
  fake.from.mockImplementation((table: string) => {
    if (table === "programs") return chain;
    throw new Error(`Unexpected table: ${table}`);
  });
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  (verifySession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    profile: { role: "admin" },
  });
});

describe("updateProgramType", () => {
  it("rejects users without coach/admin role", async () => {
    (verifySession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      profile: { role: "client" },
    });
    const result = await updateProgramType(UUID, "personal");
    expect(result.error).toBe("Нет прав");
  });

  it("rejects an invalid type value", async () => {
    const result = await updateProgramType(
      UUID,
      "archive" as "template" | "personal",
    );
    expect(result.error).toBe("Некорректный тип программы");
  });

  it("rejects a program that does not exist", async () => {
    mockProgramsTable(null);
    const result = await updateProgramType(UUID, "personal");
    expect(result.error).toBe("Программа не найдена");
  });

  it("updates type and returns success for an existing program", async () => {
    const chain = mockProgramsTable({ id: UUID });
    const result = await updateProgramType(UUID, "personal");
    expect(result.error).toBeUndefined();
    expect(chain.update).toHaveBeenCalledWith({
      type: "personal",
      updated_at: expect.any(String),
    });
    expect(chain.eq).toHaveBeenCalledWith("id", UUID);
    expect(revalidatePath).toHaveBeenCalledWith(`/programs/${UUID}`);
    expect(revalidatePath).toHaveBeenCalledWith("/programs");
  });
});
