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
