import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { safeFetch } from "@/lib/safe-fetch";
import { resolvePhotoUrls, getTodayDateStr } from "@/lib/photos";
import type { Database } from "@/types/supabase";
import { PhotoUploadForm } from "./photo-upload-form";
import { PhotoGallery } from "./photo-gallery";

const DEFAULT_TIMEZONE = "Europe/Moscow";
const PHOTOS_LIMIT = 60;

type PhotoRow = Database["public"]["Tables"]["photos"]["Row"];

export default async function PhotosPage() {
  const h = await headers();
  const clientId = h.get("x-client-id");
  if (!clientId) notFound();

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, timezone")
    .eq("id", clientId)
    .maybeSingle<{ id: string; timezone: string | null }>();

  if (!client) notFound();

  const tz = client.timezone || DEFAULT_TIMEZONE;
  const date = getTodayDateStr(tz);

  const { data: photosData } = await safeFetch(
    supabaseAdmin
      .from("photos")
      .select("*")
      .eq("client_id", clientId)
      .order("date", { ascending: false })
      .limit(PHOTOS_LIMIT),
    [] as PhotoRow[],
  );

  const photos = photosData ?? [];
  const resolvedPhotos = await resolvePhotoUrls(photos, supabaseAdmin);

  const todayPhotos = resolvedPhotos.filter((p) => p.date === date);
  const uploadedTypes = todayPhotos.map((p) => p.type) as Array<"front" | "side" | "back">;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Прогресс-фото</h2>
        <p className="text-sm text-muted-foreground">
          Загрузите фото для отслеживания прогресса
        </p>
      </div>
      <PhotoUploadForm uploadedTypes={uploadedTypes} />
      <PhotoGallery photos={resolvedPhotos} />
    </div>
  );
}
