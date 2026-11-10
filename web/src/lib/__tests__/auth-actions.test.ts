import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  from: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      signOut: mocks.signOut,
    },
    from: mocks.from,
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import { login } from "../auth-actions";

function formData(email = "coach@example.com"): FormData {
  const data = new FormData();
  data.set("email", email);
  data.set("password", "secret");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signInWithPassword.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
  mocks.signOut.mockResolvedValue({ error: null });
});

describe("login", () => {
  it("does not expose public signup/self-provisioning", async () => {
    const mod = await import("../auth-actions");
    expect((mod as Record<string, unknown>).signup).toBeUndefined();
  });

  it("rejects non-staff accounts and clears the session", async () => {
    mocks.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { role: "client" } }),
    });

    const result = await login(null, formData());

    expect(result).toEqual({ error: "Нет доступа" });
    expect(mocks.signOut).toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("rejects accounts without a staff profile", async () => {
    mocks.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    });

    const result = await login(null, formData());

    expect(result).toEqual({ error: "Нет доступа" });
    expect(mocks.signOut).toHaveBeenCalled();
  });

  it("lets staff into the dashboard", async () => {
    mocks.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { role: "coach" } }),
    });

    await login(null, formData());

    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard");
  });
});
