import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { acceptConsent } from "../actions";
import { PRIVACY_POLICY_VERSION } from "@/lib/consent";

const CLIENT_ID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  (headers as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    get: (name: string) => {
      if (name === "x-client-id") return CLIENT_ID;
      if (name === "x-forwarded-for") return "1.2.3.4";
      if (name === "user-agent") return "ua";
      return null;
    },
  });
});

describe("acceptConsent", () => {
  it("stores 18+ consent version and flags", async () => {
    let updatePayload: Record<string, unknown> | null = null;
    const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    fake.from.mockImplementation((table: string) => {
      if (table === "clients") {
        return {
          update: (payload: Record<string, unknown>) => {
            updatePayload = payload;
            return {
              eq: () => Promise.resolve({ error: null }),
            };
          },
        };
      }
      return {};
    });

    const result = await acceptConsent();
    expect(result).toEqual({});
    expect(updatePayload).toMatchObject({
      client_consent_given: true,
      client_consent_version: "2026-11-18.18plus",
      client_consent_ip: "1.2.3.4",
      client_consent_user_agent: "ua",
    });
    expect(PRIVACY_POLICY_VERSION).toBe("2026-11-18.18plus");
    expect(typeof (updatePayload as unknown as { client_consent_given_at: unknown }).client_consent_given_at).toBe("string");
  });
});
