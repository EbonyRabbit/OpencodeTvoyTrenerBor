import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const captured = vi.hoisted(() => ({
  options: null as null | {
    cookies: {
      setAll: (
        cookies: { name: string; value: string; options?: object }[],
      ) => void;
    };
  },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url, _key, options) => {
    captured.options = options;
    return {};
  }),
}));

import { createClient } from "../supabase-proxy";

describe("supabase proxy client", () => {
  it("writes refreshed cookies to the response the caller already holds", () => {
    const request = new NextRequest("http://localhost/dashboard");
    const { supabaseResponse } = createClient(request);

    captured.options?.cookies.setAll([
      { name: "sb-session", value: "fresh", options: { path: "/" } },
    ]);

    expect(supabaseResponse.cookies.get("sb-session")?.value).toBe("fresh");
    expect(request.cookies.get("sb-session")?.value).toBe("fresh");
  });
});
