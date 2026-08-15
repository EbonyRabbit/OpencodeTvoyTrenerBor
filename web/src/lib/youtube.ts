export function extractYouTubeVideoId(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (!/^https:\/\//i.test(trimmed)) return null;

  let hostname: string;
  try {
    hostname = new URL(trimmed).hostname;
  } catch {
    return null;
  }

  if (!/(?:^|\.)(youtube\.com|youtu\.be)$/i.test(hostname)) return null;

  const watch = trimmed.match(/[?&]v=([a-zA-Z0-9_-]{11})(?:[?&#]|$)/);
  if (watch) return watch[1];

  const short = trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{11})(?:[?&#]|$)/);
  if (short) return short[1];

  const embed = trimmed.match(/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{11})(?:[?&#]|$)/);
  if (embed) return embed[1];

  return null;
}