import { beforeEach, describe, expect, it, vi } from "vitest";

const list = vi.fn();
const remove = vi.fn();

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    storage: {
      from: vi.fn(() => ({ list, remove })),
    },
  },
}));

import { deleteClientPhotoStorage } from "../client-storage";

const CLIENT_ID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  list.mockResolvedValue({ data: [], error: null });
  remove.mockResolvedValue({ error: null });
});

describe("deleteClientPhotoStorage", () => {
  it("does nothing when the client folder is empty", async () => {
    await deleteClientPhotoStorage(CLIENT_ID);

    expect(list).toHaveBeenCalledWith(`clients/${CLIENT_ID}`, {
      limit: 100,
      offset: 0,
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it("recurses into folders and removes files", async () => {
    list.mockImplementation((path: string) =>
      Promise.resolve({
        data:
          path === `clients/${CLIENT_ID}`
            ? [{ id: null, name: "week1" }]
            : [{ id: "file-1", name: "front.jpg" }],
        error: null,
      }),
    );

    await deleteClientPhotoStorage(CLIENT_ID);

    expect(remove).toHaveBeenCalledWith([
      `clients/${CLIENT_ID}/week1/front.jpg`,
    ]);
  });

  it("paginates through more than one page of files", async () => {
    const firstPage = Array.from({ length: 100 }, (_, i) => ({
      id: `file-${i}`,
      name: `photo-${i}.jpg`,
    }));
    list
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    await deleteClientPhotoStorage(CLIENT_ID);

    expect(list).toHaveBeenNthCalledWith(1, `clients/${CLIENT_ID}`, {
      limit: 100,
      offset: 0,
    });
    expect(list).toHaveBeenNthCalledWith(2, `clients/${CLIENT_ID}`, {
      limit: 100,
      offset: 100,
    });
    expect(remove).toHaveBeenCalledWith(
      firstPage.map((entry) => `clients/${CLIENT_ID}/${entry.name}`),
    );
  });

  it("throws when storage listing fails", async () => {
    list.mockResolvedValue({ data: null, error: new Error("storage down") });

    await expect(deleteClientPhotoStorage(CLIENT_ID)).rejects.toThrow(
      "storage down",
    );
  });

  it("throws when removing files fails", async () => {
    list.mockResolvedValue({
      data: [{ id: "file-1", name: "front.jpg" }],
      error: null,
    });
    remove.mockResolvedValue({ error: new Error("remove failed") });

    await expect(deleteClientPhotoStorage(CLIENT_ID)).rejects.toThrow(
      "remove failed",
    );
  });
});
