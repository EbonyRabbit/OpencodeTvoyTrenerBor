import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase-proxy";
import { supabaseAdmin } from "@/lib/supabase-admin";

const protectedRoutes = ["/dashboard", "/clients", "/programs", "/checkins", "/chat"];
const authRoutes = ["/login"];

const CLIENT_ROUTE_EXCLUSIONS = ["/client/expired"];

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitMap.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW_MS);

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

function extractClientToken(pathname: string): string | null {
  if (CLIENT_ROUTE_EXCLUSIONS.some((ex) => pathname.startsWith(ex))) {
    return null;
  }
  const match = pathname.match(/^\/client\/([^/]+)/);
  return match ? match[1] : null;
}

async function validateClientToken(token: string): Promise<{ clientId: string } | null> {
  try {
    const { data } = await supabaseAdmin
      .from("client_tokens")
      .select("client_id, clients!inner(status)")
      .eq("token", token)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!data) return null;
    const row = data as { client_id: string; clients: { status: string } };
    if (row.clients?.status !== "active") return null;
    return { clientId: row.client_id };
  } catch {
    return null;
  }
}

async function updateLastUsedAt(token: string): Promise<void> {
  try {
    await supabaseAdmin
      .from("client_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("token", token);
  } catch {
    // best-effort audit update
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const clientToken = extractClientToken(pathname);
  if (clientToken) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (isRateLimited(ip)) {
      return new NextResponse("Too Many Requests", { status: 429 });
    }
    const valid = await validateClientToken(clientToken);
    if (!valid) {
      return NextResponse.redirect(new URL("/client/expired", request.url));
    }
    updateLastUsedAt(clientToken);
    const response = NextResponse.next();
    response.headers.set("x-client-id", valid.clientId);
    return response;
  }

  const { supabase, supabaseResponse } = createClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtected = protectedRoutes.some((route) => pathname.startsWith(route));
  const isAuth = authRoutes.includes(pathname);

  if (isProtected && !user) {
    const url = new URL("/login", request.url);
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  if (isAuth && user) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
