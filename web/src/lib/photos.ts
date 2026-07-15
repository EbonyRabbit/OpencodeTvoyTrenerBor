export function getGoogleDriveFileId(url: string): string | null {
  if (!url) return null;
  try {
    const patterns = [
      /\/d\/([a-zA-Z0-9_-]+)/,
      /id=([a-zA-Z0-9_-]+)/,
      /\/file\/d\/([a-zA-Z0-9_-]+)/,
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  } catch {
    return null;
  }
}

export function getDriveThumbnailUrl(url: string): string {
  const fileId = getGoogleDriveFileId(url);
  if (!fileId) return url;
  return `https://lh3.googleusercontent.com/d/${fileId}=w400`;
}

export function getDriveImageUrl(url: string): string {
  const fileId = getGoogleDriveFileId(url);
  if (!fileId) return url;
  return `https://lh3.googleusercontent.com/d/${fileId}=w1200`;
}

export const PHOTO_TYPE_LABELS: Record<string, string> = {
  front: "Фронтальное",
  side: "Боковое",
  back: "Заднее",
};

export const PHOTO_TYPE_ORDER: Record<string, number> = {
  front: 0,
  side: 1,
  back: 2,
};

export function getTodayDateStr(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

const STORAGE_BUCKET = "client-photos";
const SIGNED_URL_TTL = 3600;

export async function resolvePhotoUrls<T extends { id: string; drive_url: string | null; storage_path: string | null }>(
  photos: T[],
  supabase: { storage: { from: (bucket: string) => { createSignedUrl: (path: string, ttl: number) => Promise<{ data: { signedUrl: string } | null; error: unknown }> } } },
): Promise<(T & { resolvedUrl: string | null })[]> {
  return Promise.all(
    photos.map(async (photo) => {
      if (photo.storage_path) {
        try {
          const { data, error } = await supabase.storage
            .from(STORAGE_BUCKET)
            .createSignedUrl(photo.storage_path, SIGNED_URL_TTL);
          if (!error && data?.signedUrl) {
            return { ...photo, resolvedUrl: data.signedUrl };
          }
        } catch (err) {
          console.warn(`[resolvePhotoUrls] Failed for photo ${photo.id}:`, err);
        }
      }
      if (photo.drive_url) {
        return { ...photo, resolvedUrl: getDriveThumbnailUrl(photo.drive_url) };
      }
      return { ...photo, resolvedUrl: null };
    }),
  );
}
