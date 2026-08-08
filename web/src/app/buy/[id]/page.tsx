import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { UUID_REGEX } from "@/lib/validation";
import { BuyForm, type BuyProgram } from "./buy-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) return { title: "Программа" };

  const { data } = await supabaseAdmin
    .from("programs")
    .select("title")
    .eq("id", id)
    .eq("active", true)
    .is("client_id", null)
    .maybeSingle<{ title: string }>();

  return { title: data?.title ? `Купить: ${data.title}` : "Программа" };
}

export default async function BuyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tg?: string | string[]; u?: string | string[] }>;
}) {
  const { id } = await params;
  const { tg, u } = await searchParams;

  if (!UUID_REGEX.test(id)) {
    notFound();
  }

  const { data: program, error } = await supabaseAdmin
    .from("programs")
    .select("id, title, type, description, duration_weeks, price")
    .eq("id", id)
    .eq("active", true)
    .is("client_id", null)
    .maybeSingle<BuyProgram>();

  if (error) {
    throw new Error(`Failed to load program ${id}: ${error.message}`);
  }
  if (!program) {
    notFound();
  }

  const tgRaw = typeof tg === "string" ? tg.trim() : "";
  const telegramId = /^\d{5,15}$/.test(tgRaw) ? Number(tgRaw) : null;
  const uRaw = typeof u === "string" ? u.trim() : "";
  const telegramUsername = /^[A-Za-z0-9_]{3,32}$/.test(uRaw) ? uRaw : null;
  const initialContact = telegramUsername ?? "";

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-10">
        <BuyForm
          program={program}
          initialContact={initialContact}
          telegramId={telegramId}
          telegramUsername={telegramUsername}
        />
      </main>
    </div>
  );
}
