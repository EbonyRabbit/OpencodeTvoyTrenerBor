import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { verifySession } from "@/lib/dal";
import { createClient } from "@/lib/supabase-server";
import { ChatInterface } from "./_components/chat-interface";
import type { Database } from "@/types/supabase";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("name")
    .eq("id", id)
    .maybeSingle<{ name: string }>();
  return {
    title: data?.name ? `Чат — ${data.name}` : "Чат",
  };
}

export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [session, { id }] = await Promise.all([
    verifySession(),
    params,
  ]);
  const { profile, supabase } = session;

  if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
    redirect("/dashboard");
  }

  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", id)
    .maybeSingle<{ id: string; name: string }>();

  if (!client) {
    notFound();
  }

  const PAGE_SIZE = 100;
  const { data: messages } = await supabase
    .from("messages")
    .select("*")
    .eq("client_id", id)
    .order("sent_at", { ascending: false })
    .limit(PAGE_SIZE + 1);

  const hasMore = (messages?.length ?? 0) > PAGE_SIZE;
  const initialMessages = ((hasMore ? messages!.slice(0, PAGE_SIZE) : messages ?? []) as Database["public"]["Tables"]["messages"]["Row"][]).reverse();

  return (
    <div className="p-6">
      <ChatInterface
        clientId={client.id}
        clientName={client.name}
        initialMessages={initialMessages}
        initialHasMore={hasMore}
        coachId={profile.id}
      />
    </div>
  );
}
