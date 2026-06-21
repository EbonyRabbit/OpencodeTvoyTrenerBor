import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase-admin";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return NextResponse.json({ error: "Нет прав" }, { status: 403 });
    }

    const { id: clientId } = await params;
    const body = await request.json();
    const text = body.text?.trim();
    const idempotencyKey = body.idempotency_key as string | undefined;

    if (!text) {
      return NextResponse.json({ error: "Сообщение не может быть пустым" }, { status: 400 });
    }

    if (text.length > 4000) {
      return NextResponse.json({ error: "Сообщение слишком длинное (максимум 4000 символов)" }, { status: 400 });
    }

    if (idempotencyKey) {
      const oneSecondAgo = new Date(Date.now() - 1000).toISOString();
      const { data: existing } = await supabaseAdmin
        .from("messages")
        .select("id, coach_id")
        .eq("client_id", clientId)
        .eq("direction", "to_client")
        .eq("text", text)
        .gte("created_at", oneSecondAgo)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        return NextResponse.json({
          success: true,
          messageId: existing.id,
          coachId: existing.coach_id,
        });
      }
    }

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id, telegram_id")
      .eq("id", clientId)
      .maybeSingle();

    if (!client) {
      return NextResponse.json({ error: "Клиент не найден" }, { status: 404 });
    }

    const now = new Date().toISOString();

    const { data: inserted, error: dbError } = await supabaseAdmin
      .from("messages")
      .insert({
        client_id: clientId,
        coach_id: profile.id,
        direction: "to_client",
        text,
        sent_at: now,
        read_at: null,
      })
      .select("id, coach_id")
      .single();

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    if (BOT_TOKEN && client.telegram_id) {
      try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: client.telegram_id, text }),
        });

        if (!resp.ok) {
          const body = await resp.json();
          if (body?.error_code === 403) {
            return NextResponse.json({
              success: true,
              messageId: inserted.id,
              coachId: inserted.coach_id,
              warning: "Клиент заблокировал бота. Сообщение сохранено.",
            });
          }
          return NextResponse.json({
            success: true,
            messageId: inserted.id,
            coachId: inserted.coach_id,
            warning: "Сообщение сохранено, но отправка в Telegram временно недоступна.",
          });
        }
      } catch {
        return NextResponse.json({
          success: true,
          messageId: inserted.id,
          coachId: inserted.coach_id,
          warning: "Сообщение сохранено, но не удалось отправить в Telegram.",
        });
      }
    }

    return NextResponse.json({
      success: true,
      messageId: inserted.id,
      coachId: inserted.coach_id,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Произошла ошибка" },
      { status: 500 },
    );
  }
}
