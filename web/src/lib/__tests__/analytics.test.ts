import { describe, it, expect, vi } from "vitest";
import { getFunnelCounts, formatFunnelLabel, FUNNEL_ACTIONS } from "../analytics.js";

function mockSupabase(counts: Record<string, number>) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          gte: () => Promise.resolve({ count: counts[table] ?? 0, error: null }),
        }),
      }),
    }),
  } as any;
}

describe("analytics funnel", () => {
  it("FUNNEL_ACTIONS includes 4 steps", () => {
    expect(FUNNEL_ACTIONS).toEqual(["channel_join_inst", "welcome_sent", "welcome_followup1", "welcome_followup2"]);
  });

  it("formatFunnelLabel returns ru labels", () => {
    expect(formatFunnelLabel("welcome_sent")).toContain("Старт");
    expect(formatFunnelLabel("channel_join_inst")).toContain("Вступили");
  });

  it("getFunnelCounts queries bot_logs per action", async () => {
    let queried: string[] = [];
    const supabase = {
      from: (table: string) => ({
        select: (_a: string, _o: any) => ({
          eq: (col: string, val: string) => {
            queried.push(val);
            return {
              gte: (_c: string, _since: string) => Promise.resolve({ count: val === "welcome_sent" ? 5 : 2, error: null }),
            };
          },
        }),
      }),
    } as any;
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const counts = await getFunnelCounts(supabase, since);
    expect(queried).toContain("welcome_sent");
    expect(counts.welcome_sent).toBe(5);
    expect(counts.channel_join_inst).toBe(2);
  });
});
