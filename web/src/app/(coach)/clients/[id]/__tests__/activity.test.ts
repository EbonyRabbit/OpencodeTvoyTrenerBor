import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/dal", () => ({
  verifySession: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { verifySession } from "@/lib/dal";
import { createClient } from "@/lib/supabase-server";
import {
  getClientActivity,
  loadMoreActivity,
} from "../actions";

const CLIENT_ID = "11111111-2222-3333-4444-555555555555";
const COACH_ID = "22222222-2222-2222-2222-222222222222";
const BAD_ID = "not-a-uuid";

const WORKOUT_ROW = {
  id: "w1",
  created_at: "2024-01-01T10:00:00.000Z",
  exercise: "Squat",
  sets: 3,
  reps: "5",
  weight: 100,
};
const CHECKIN_ROW = {
  id: "c1",
  created_at: "2024-01-02T10:00:00.000Z",
  wellbeing: 4,
  sleep: 4,
  stress: 2,
};

function mockSupabase() {
  const fake = createClient as unknown as ReturnType<typeof vi.fn>;
  fake.mockResolvedValue({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        range: () =>
          Promise.resolve({
            data:
              table === "workout_logs"
                ? [WORKOUT_ROW]
                : table === "checkins"
                  ? [CHECKIN_ROW]
                  : [],
            error: null,
          }),
      };
      return chain;
    },
  });
}

function mockUnauthenticated() {
  (verifySession as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    () => {
      throw new Error("NEXT_REDIRECT");
    },
  );
}

function mockAuthenticated() {
  (verifySession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    profile: { id: COACH_ID, role: "coach" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticated();
  mockSupabase();
});

describe("getClientActivity", () => {
  it("rejects (throws) when there is no session", async () => {
    mockUnauthenticated();
    await expect(getClientActivity(CLIENT_ID)).rejects.toThrow();
  });

  it("returns an error for a non-UUID client id", async () => {
    const result = await getClientActivity(BAD_ID);
    expect((result as { error?: string }).error).toBe(
      "Некорректный идентификатор",
    );
  });

  it("returns shaped events when authenticated and given a valid UUID", async () => {
    const result = await getClientActivity(CLIENT_ID);
    const events = (result as { events?: unknown[] }).events;
    expect(Array.isArray(events)).toBe(true);
    expect(events?.length).toBeGreaterThan(0);
    expect(events?.some((e) => (e as { event_type?: string }).event_type === "workout")).toBe(true);
  });
});

describe("loadMoreActivity", () => {
  it("rejects (throws) when there is no session", async () => {
    mockUnauthenticated();
    await expect(loadMoreActivity(CLIENT_ID, 0)).rejects.toThrow();
  });

  it("returns an error for a non-UUID client id", async () => {
    const result = await loadMoreActivity(BAD_ID, 0);
    expect((result as { error?: string }).error).toBe(
      "Некорректный идентификатор",
    );
  });

  it("returns shaped events when authenticated and given a valid UUID", async () => {
    const result = await loadMoreActivity(CLIENT_ID, 0);
    const events = result as unknown as unknown[];
    expect(Array.isArray(events)).toBe(true);
    expect(events?.length).toBeGreaterThan(0);
    expect(events?.some((e) => (e as { event_type?: string }).event_type === "workout")).toBe(true);
  });
});
