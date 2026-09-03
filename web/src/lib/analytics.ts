export const FUNNEL_ACTIONS = [
  "channel_join_inst",
  "welcome_sent",
  "welcome_followup1",
  "welcome_followup2",
] as const;

export type FunnelAction = (typeof FUNNEL_ACTIONS)[number];
export type FunnelCounts = Record<FunnelAction, number>;

export function funnelActions(): readonly string[] {
  return FUNNEL_ACTIONS;
}

export async function getFunnelCounts(
  supabase: { from: (table: string) => any },
  sinceIso: string,
): Promise<FunnelCounts> {
  const counts: FunnelCounts = {
    channel_join_inst: 0,
    welcome_sent: 0,
    welcome_followup1: 0,
    welcome_followup2: 0,
  };
  for (const action of FUNNEL_ACTIONS) {
    const { count, error } = await supabase
      .from("bot_logs")
      .select("id", { count: "exact", head: true })
      .eq("action", action)
      .gte("created_at", sinceIso);
    if (!error && typeof count === "number") counts[action] = count;
  }
  return counts;
}

export function formatFunnelLabel(action: FunnelAction): string {
  const map: Record<FunnelAction, string> = {
    channel_join_inst: "Вступили (inst_ZIR)",
    welcome_sent: "Старт бота",
    welcome_followup1: "Followup 1д",
    welcome_followup2: "Followup 3д",
  };
  return map[action];
}
