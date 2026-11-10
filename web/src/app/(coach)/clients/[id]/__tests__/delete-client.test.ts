import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/dal", () => ({
  verifySession: vi.fn(),
}));

vi.mock("@/lib/client-storage", () => ({
  deleteClientPhotoStorage: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

import { verifySession } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { deleteClientPhotoStorage } from "@/lib/client-storage";
import { deleteClient } from "../actions";

const CLIENT_ID = "11111111-2222-3333-4444-555555555555";

function mockClient(
  client: {
    id: string;
    telegram_id: number | null;
    spreadsheet_id?: string | null;
  } | null,
  externalPhoto: { id: string } | null = null,
  externalError: { message: string } | null = null,
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
      or: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      maybeSingle: vi.fn(() =>
        Promise.resolve({
          data:
            table === "clients"
              ? client
              : table === "photos"
                ? externalPhoto
                : null,
          error:
            table === "clients"
              ? clientError
              : table === "photos"
                ? externalError
                : null,
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

  it("cleans storage when the client was already deleted", async () => {
    mockClient(null);
    (deleteClientPhotoStorage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );

    const result = await deleteClient(CLIENT_ID);

    expect(result.error).toBeUndefined();
    expect(deleteClientPhotoStorage).toHaveBeenCalledWith(CLIENT_ID);
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the client lookup errors", async () => {
    mockClient(null, null, null, { message: "db down" });

    const result = await deleteClient(CLIENT_ID);

    expect(result.error).toContain("Не удалось загрузить клиента");
    expect(deleteClientPhotoStorage).not.toHaveBeenCalled();
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the external photo check errors", async () => {
    mockClient(
      { id: CLIENT_ID, telegram_id: 42, spreadsheet_id: null },
      null,
      { message: "db timeout" },
    );

    const result = await deleteClient(CLIENT_ID);

    expect(result.error).toContain("Не удалось проверить внешние файлы");
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("blocks deletion while external Google files are linked", async () => {
    mockClient({ id: CLIENT_ID, telegram_id: 42, spreadsheet_id: "sheet-1" });

    const result = await deleteClient(CLIENT_ID);

    expect(result.error).toContain("Google Drive/Sheets");
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("blocks deletion while a photo links to Google Drive", async () => {
    mockClient(
      { id: CLIENT_ID, telegram_id: 42, spreadsheet_id: null },
      { id: "photo-1" },
    );

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
    (deleteClientPhotoStorage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );

    const result = await deleteClient(CLIENT_ID, true);

    expect(result.error).toBeUndefined();
    expect(fake.rpc).toHaveBeenCalledWith("delete_client_cascade", {
      p_client_id: CLIENT_ID,
      p_telegram_id: 42,
    });
  });

  it("deletes PII atomically and cleans photo storage", async () => {
    const fake = mockClient({ id: CLIENT_ID, telegram_id: 42 });
    fake.rpc.mockResolvedValue({ error: null });
    (deleteClientPhotoStorage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await deleteClient(CLIENT_ID);

    expect(result.error).toBeUndefined();
    expect(fake.rpc).toHaveBeenCalledWith("delete_client_cascade", {
      p_client_id: CLIENT_ID,
      p_telegram_id: 42,
    });
    expect(deleteClientPhotoStorage).toHaveBeenCalledWith(CLIENT_ID);
  });

  it("does not report success when the database deletion fails", async () => {
    const fake = mockClient({ id: CLIENT_ID, telegram_id: 42 });
    fake.rpc.mockResolvedValue({ error: { message: "db down" } });

    const result = await deleteClient(CLIENT_ID);

    expect(result.error).toBe("db down");
    expect(deleteClientPhotoStorage).not.toHaveBeenCalled();
  });

  it("keeps the deleted client and reports storage cleanup failure", async () => {
    const fake = mockClient({ id: CLIENT_ID, telegram_id: null });
    fake.rpc.mockResolvedValue({ error: null });
    (deleteClientPhotoStorage as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("storage down"),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await deleteClient(CLIENT_ID);

    expect(result.error).toContain("Клиент удалён, но фото не удалены");
    expect(fake.rpc).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
