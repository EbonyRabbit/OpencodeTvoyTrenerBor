import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase-proxy", () => ({
  createClient: vi.fn(() => ({
    supabase: {
      auth: { getUser: mocks.getUser, signOut: vi.fn() },
      from: mocks.from,
    },
    supabaseResponse: NextResponse.next(),
  })),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {},
}));

import { proxy } from "../proxy";

describe("proxy client identity header", () => {
  it("strips a spoofed x-client-id before non-portal routing", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const request = new NextRequest("http://localhost/login", {
      headers: { "x-client-id": "attacker-controlled-uuid" },
    });

    await proxy(request);

    expect(request.headers.get("x-client-id")).toBeNull();
  });
});
