import { config } from "../config.js";
import { supabaseAdmin } from "./supabase-admin.js";

const TELEGRAM_API = `https://api.telegram.org/bot${config.telegram.botToken}`;

export interface TelegramFile {
  file_id: string;
  file_size: number;
  file_path: string;
}

export async function getTelegramFile(fileId: string): Promise<TelegramFile> {
  const res = await fetch(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
  if (!res.ok) throw new Error(`getFile failed: ${res.status}`);
  const json = await res.json() as { result: TelegramFile };
  return json.result;
}

export async function downloadTelegramFile(filePath: string): Promise<Uint8Array> {
  const res = await fetch(`${TELEGRAM_API}/file/${filePath}`);
  if (!res.ok) throw new Error(`File download failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

export async function uploadPhotoToStorage(
  clientId: string,
  week: number | null,
  photoType: string,
  fileBuffer: Uint8Array,
): Promise<string> {
  const date = new Date().toISOString().split("T")[0];
  const weekPart = week != null ? `week${week}` : "noweek";
  const path = `clients/${clientId}/${weekPart}_${date}/${photoType}.jpg`;

  const { error } = await supabaseAdmin.storage
    .from("client-photos")
    .upload(path, fileBuffer, {
      contentType: "image/jpeg",
      upsert: true,
    });

  if (error) throw error;
  return path;
}

export async function savePhotoRecord(
  clientId: string,
  week: number | null,
  photoType: string,
  storagePath: string,
): Promise<void> {
  const date = new Date().toISOString().split("T")[0];

  const { error } = await supabaseAdmin
    .from("photos")
    .upsert({
      client_id: clientId,
      date,
      week,
      type: photoType as "front" | "side" | "back",
      storage_path: storagePath,
      drive_url: null,
      folder_url: null,
    } as never, { onConflict: "client_id,date,type" });

  if (error) throw error;
}

export async function getPhotoDownloadUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from("client-photos")
    .createSignedUrl(storagePath, 3600);

  if (error) throw error;
  return data.signedUrl;
}
