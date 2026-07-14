import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase-proxy";
import { supabaseAdmin } from "@/lib/supabase-admin";

const protectedRoutes = ["/dashboard", "/clients", "/programs", "/checkins", "/chat"];
const authRoutes = ["/login"];

const CLIENT_ROUTE_EXCLUSIONS = ["/client/expired"];

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
      .select("client_id")
      .eq("token", token)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    return data ? { clientId: data.client_id } : null;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const clientToken = extractClientToken(pathname);
  if (clientToken) {
    const valid = await validateClientToken(clientToken);
    if (!valid) {
      return NextResponse.redirect(new URL("/client/expired", request.url));
    }
    const response = NextResponse.next();
    response.headers.set("x-client-id", valid.clientId);
    response.headers.set("x-client-token", clientToken);
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
