// DISABLED: photo storage removed - photos are saved by clients on their own devices
// Original file preserved for reference in case photo storage is re-enabled later

/*
import { config } from "../config.js";
import { supabaseAdmin } from "./supabase-admin.js";
import { getTodayDateStr } from "./workout-utils.js";
import { DEFAULT_TIMEZONE } from "./constants.js";

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
  timezone?: string,
): Promise<string> {
  const tz = timezone || DEFAULT_TIMEZONE;
  const date = getTodayDateStr(tz);
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
  timezone?: string,
): Promise<void> {
  const tz = timezone || DEFAULT_TIMEZONE;
  const date = getTodayDateStr(tz);

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

export interface PhotoSet {
  date: string;
  photos: { type: string; storage_path: string | null; drive_url: string | null }[];
}

export async function getLatestPhotoSets(
  clientId: string,
  limit = 5,
): Promise<PhotoSet[]> {
  const { data, error } = await supabaseAdmin
    .from("photos")
    .select("date, type, storage_path, drive_url")
    .eq("client_id", clientId)
    .order("date", { ascending: false })
    .limit(limit * 3 + 3);

  if (error) {
    console.error(`[PHOTOS] Failed to fetch photo sets for ${clientId}:`, error);
    return [];
  }
  if (!data) return [];

  const grouped = new Map<string, PhotoSet>();
  for (const row of data) {
    const existing = grouped.get(row.date);
    if (existing) {
      existing.photos.push(row);
    } else if (grouped.size < limit) {
      grouped.set(row.date, { date: row.date, photos: [row] });
    }
  }

  return Array.from(grouped.values());
}
*/
