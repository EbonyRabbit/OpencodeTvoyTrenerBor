import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { verifySession } from "@/lib/dal";
import { createClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { safeFetch, safeCount } from "@/lib/safe-fetch";
import { resolvePhotoUrls } from "@/lib/photos";
import { PhotoGallery } from "./_components/photo-gallery";

const PAGE_SIZE = 15;

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
    title: data?.name ? `Фото — ${data.name}` : "Фото",
  };
}

export default async function PhotosPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const [session, { id }, sp] = await Promise.all([
    verifySession(),
    params,
    searchParams,
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

  const rawPage = parseInt(sp.page ?? "1", 10) || 1;
  const currentPage = Math.max(1, rawPage);

  const [{ data: photos }, { count }] = await Promise.all([
    safeFetch(
      supabase
        .from("photos")
        .select("*")
        .eq("client_id", id)
        .order("date", { ascending: false })
        .range((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE - 1),
      [],
    ),
    safeCount(
      supabase
        .from("photos")
        .select("*", { count: "exact", head: true })
        .eq("client_id", id),
    ),
  ]);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const clampedPage = Math.min(currentPage, totalPages);

  if (clampedPage !== currentPage) {
    redirect(`/clients/${id}/photos?page=${clampedPage}`);
  }

  const resolvedPhotos = await resolvePhotoUrls(photos ?? [], supabaseAdmin);

  return (
    <div className="p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <PhotoGallery
          clientId={client.id}
          clientName={client.name}
          photos={resolvedPhotos}
          currentPage={currentPage}
          totalPages={totalPages}
        />
      </div>
    </div>
  );
}
