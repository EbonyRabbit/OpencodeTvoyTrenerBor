export async function safeFetch<T>(
  query: PromiseLike<{ data: T | null; error: unknown }>,
  fallback: T | null,
): Promise<{ data: T | null }> {
  try {
    const result = await query;
    return { data: result.data ?? fallback };
  } catch (e) {
    console.error("safeFetch failed:", e);
    return { data: fallback };
  }
}

export async function safeCount(
  query: PromiseLike<{ count: number | null; error: unknown }>,
): Promise<{ count: number }> {
  try {
    const result = await query;
    return { count: result.count ?? 0 };
  } catch (e) {
    console.error("safeCount failed:", e);
    return { count: 0 };
  }
}
