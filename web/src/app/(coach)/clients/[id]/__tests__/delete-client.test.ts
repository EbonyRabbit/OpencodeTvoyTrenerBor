import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/dal", () => ({
  verifySession: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

import { verifySession } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { deleteClient } from "../actions";

const CLIENT_ID = "11111111-2222-3333-4444-555555555555";

function mockClient(
  client: {
    id: string;
    telegram_id: number | null;
    spreadsheet_id?: string | null;
  } | null,
  clientError: { message: string } | null = null,
) {
  const fake = supabaseAdmin as unknown as {
    from: ReturnType<typeof vi.fn>;
    rpc: ReturnType<typeof vi.fn>;
  };
  fake.from.mockImplementation((table: string) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(() =>
        Promise.resolve({
          data: table === "clients" ? client : null,
          error: table === "clients" ? clientError : null,
        }),
      ),
    };
    return chain;
  });
  return fake;
}

beforeEach(() => {
  vi.clearAllMocks();
  (verifySession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    profile: { id: "coach-id", role: "coach" },
  });
});

describe("deleteClient", () => {
  it("rejects non-staff users", async () => {
    (verifySession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      profile: { id: "coach-id", role: "client" },
    });
    mockClient({ id: CLIENT_ID, telegram_id: 42 });

    const result = await deleteClient(CLIENT_ID);

    expect(result.error).toBe("Нет прав");
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID id", async () => {
    mockClient({ id: CLIENT_ID, telegram_id: 42 });

    const result = await deleteClient("not-a-uuid");

    expect(result.error).toBe("Некорректный идентификатор");
  });

  it("returns success when the client was already deleted", async () => {
    mockClient(null);

    const result = await deleteClient(CLIENT_ID);

    expect(result.error).toBeUndefined();
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the client lookup errors", async () => {
    mockClient(null, { message: "db down" });

    const result = await deleteClient(CLIENT_ID);

    expect(result.error).toContain("Не удалось загрузить клиента");
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("blocks deletion while external Google files are linked", async () => {
    mockClient({ id: CLIENT_ID, telegram_id: 42, spreadsheet_id: "sheet-1" });

    const result = await deleteClient(CLIENT_ID);

    expect(result.error).toContain("Google Drive/Sheets");
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("allows forced deletion after external files were removed manually", async () => {
    const fake = mockClient({
      id: CLIENT_ID,
      telegram_id: 42,
      spreadsheet_id: "sheet-1",
    });
    fake.rpc.mockResolvedValue({ error: null });

    const result = await deleteClient(CLIENT_ID, true);

    expect(result.error).toBeUndefined();
    expect(fake.rpc).toHaveBeenCalledWith("delete_client_cascade", {
      p_client_id: CLIENT_ID,
      p_telegram_id: 42,
    });
  });

  it("deletes client data atomically", async () => {
    const fake = mockClient({ id: CLIENT_ID, telegram_id: 42 });
    fake.rpc.mockResolvedValue({ error: null });

    const result = await deleteClient(CLIENT_ID);

    expect(result.error).toBeUndefined();
    expect(fake.rpc).toHaveBeenCalledWith("delete_client_cascade", {
      p_client_id: CLIENT_ID,
      p_telegram_id: 42,
    });
  });

  it("does not report success when the database deletion fails", async () => {
    const fake = mockClient({ id: CLIENT_ID, telegram_id: 42 });
    fake.rpc.mockResolvedValue({ error: { message: "db down" } });

    const result = await deleteClient(CLIENT_ID);

    expect(result.error).toBe("db down");
  });
});
