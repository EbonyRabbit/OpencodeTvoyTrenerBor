import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { UUID_REGEX } from "@/lib/validation";
import { ProgramCardPage, type BuyProgram } from "./program-card";

function buildBotDeepLink(): string {
  const raw = process.env.TELEGRAM_BOT_USERNAME?.trim() ?? "";
  if (!raw) return "";
  const username = raw.replace(/^@/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9_]{4,64}$/.test(username)) return "";
  return `https://t.me/${username}/programs`;
}

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
    .eq("type", "template")
    .is("client_id", null)
    .maybeSingle<{ title: string }>();

  return { title: data?.title ? `Программа: ${data.title}` : "Программа" };
}

export default async function BuyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!UUID_REGEX.test(id)) {
    notFound();
  }

  const { data: program, error } = await supabaseAdmin
    .from("programs")
    .select("id, title, type, description, duration_weeks, price")
    .eq("id", id)
    .eq("active", true)
    .eq("type", "template")
    .is("client_id", null)
    .maybeSingle<BuyProgram>();

  if (error) {
    throw new Error(`Failed to load program ${id}: ${error.message}`);
  }
  if (!program) {
    notFound();
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-10">
        <ProgramCardPage program={program} botDeepLink={buildBotDeepLink()} />
      </main>
    </div>
  );
}
