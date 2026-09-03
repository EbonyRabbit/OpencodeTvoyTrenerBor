import type { MyContext } from "../bot.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";

export async function handleChannelJoin(ctx: MyContext): Promise<void> {
  const member = (ctx as any).chatMember;
  if (!member) return;
  const oldStatus = member.old_chat_member?.status;
  const newStatus = member.new_chat_member?.status;
  const isJoin = (oldStatus === "left" || oldStatus === "kicked") && (newStatus === "member" || newStatus === "administrator" || newStatus === "creator");
  if (!isJoin) return;

  const inviteName = member.invite_link?.name;
  if (inviteName !== "inst_ZIR") return;

  const telegramId = member.from?.id ?? (ctx.from?.id as number | undefined);
  if (!telegramId) return;

  try {
    const { error } = await supabaseAdmin.from("bot_logs").insert({
      action: "channel_join_inst",
      telegram_id: telegramId,
      status: "ok",
      details: inviteName,
    });
    if (error) console.warn("[CHANNEL_JOIN] bot_logs insert failed:", error.code);
  } catch (err) {
    console.warn("[CHANNEL_JOIN] Failed to log channel_join_inst:", err);
  }
}
