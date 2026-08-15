import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { createClient } from "@/lib/supabase-server";

const PAGE_SIZE = 50;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return NextResponse.json({ error: "Нет прав" }, { status: 403 });
    }

    const { id: clientId } = await params;
    const { searchParams } = new URL(request.url);
    const before = searchParams.get("before");

    const supabase = await createClient();

    let query = supabase
      .from("messages")
      .select("*")
      .eq("client_id", clientId)
      .order("sent_at", { ascending: false })
      .limit(PAGE_SIZE + 1);

    if (before) {
      query = query.lt("sent_at", before);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const hasMore = data.length > PAGE_SIZE;
    const messages = hasMore ? data.slice(0, PAGE_SIZE).reverse() : data.reverse();

    return NextResponse.json({ messages, hasMore });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Произошла ошибка" },
      { status: 500 },
    );
  }
}
