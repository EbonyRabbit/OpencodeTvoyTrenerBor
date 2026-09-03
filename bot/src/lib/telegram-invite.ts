import type { Bot } from "grammy";
import type { MyContext } from "../bot.js";

export async function createChannelInviteLink(bot: Bot<MyContext>, chatId: string | number): Promise<string> {
  const link = await bot.api.createChatInviteLink(chatId, {
    name: "inst_ZIR",
    creates_join_request: false,
  });
  return link.invite_link;
}
