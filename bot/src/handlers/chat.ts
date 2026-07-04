import type { MyContext } from "../bot.js";
import { t, type Language } from "../i18n/index.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { findClientByTelegramId } from "../lib/clients.js";
import { config } from "../config.js";
import { setState, clearState, getState, type BotState } from "../state/machine.js";
import { InlineKeyboard } from "grammy";

const COACH_CHAT_ID = config.coachChatId;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_KEYBOARD_BUTTONS = 50;

async function storeMessage(
  clientId: string,
  direction: "to_client" | "to_coach",
  text: string,
  coachId?: string,
): Promise<void> {
  const { error } = await supabaseAdmin.from("messages").insert({
    client_id: clientId,
    coach_id: coachId ?? null,
    direction,
    text,
    sent_at: new Date().toISOString(),
    read_at: null,
  });

  if (error) {
    console.error(`[CHAT] Failed to store message:`, error.code);
  }
}

async function getClientForCoach(state: BotState | null): Promise<string | null> {
  if (state?.action === "chat" && state.data && typeof state.data === "object") {
    const data = state.data as Record<string, unknown>;
    if (typeof data.client_id === "string") {
      return data.client_id;
    }
  }
  return null;
}

export async function handleFreeTextMessage(ctx: MyContext): Promise<void> {
  if (!ctx.from?.id || !ctx.message?.text) return;

  const text = ctx.message.text;
  const lang = ctx.language;

  if (text.length > MAX_MESSAGE_LENGTH) {
    await ctx.reply(t("chat.message_too_long", lang));
    return;
  }

  const client = await findClientByTelegramId(ctx.from.id);
  if (!client) return;

  await storeMessage(client.id, "to_coach", text);

  try {
    const { bot } = await import("../bot.js");
    const clientName = client.name ?? t("greeting.default_name", lang);
    const forwarded = `📩 ${clientName} (ID: ${client.id.slice(0, 8)}):\n\n${text}`;

    if (forwarded.length > MAX_MESSAGE_LENGTH) {
      await bot.api.sendMessage(String(COACH_CHAT_ID), forwarded.slice(0, MAX_MESSAGE_LENGTH) + "\n\n⚠️ " + t("chat.truncated", lang));
    } else {
      await bot.api.sendMessage(String(COACH_CHAT_ID), forwarded);
    }
  } catch (err) {
    console.warn(`[CHAT] Failed to forward to coach:`, err);
  }
}

export async function handleCoachIncoming(ctx: MyContext): Promise<boolean> {
  if (!ctx.from?.id || ctx.from.id !== Number(COACH_CHAT_ID)) return false;
  if (!ctx.message?.text) return false;

  const text = ctx.message.text;
  if (text.startsWith("/")) return false;

  const state = await getState(ctx.from.id);
  const targetClientId = await getClientForCoach(state);

  if (!targetClientId) {
    await ctx.reply(t("chat.select_client_hint", ctx.language));
    return true;
  }

  if (text.length > MAX_MESSAGE_LENGTH) {
    await ctx.reply(t("chat.message_too_long", ctx.language));
    return true;
  }

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, telegram_id, language")
    .eq("id", targetClientId)
    .maybeSingle();

  if (!client?.telegram_id) {
    await storeMessage(targetClientId, "to_client", text, String(COACH_CHAT_ID));
    await ctx.reply(t("chat.client_no_telegram", ctx.language));
    return true;
  }

  await storeMessage(targetClientId, "to_client", text, String(COACH_CHAT_ID));

  try {
    const { bot } = await import("../bot.js");
    const lang = (client.language || "ru") as Language;
    const prefix = t("chat.coach_prefix", lang);
    const msg = `${prefix}\n\n${text}`;

    if (msg.length > MAX_MESSAGE_LENGTH) {
      await bot.api.sendMessage(client.telegram_id, msg.slice(0, MAX_MESSAGE_LENGTH) + "\n\n⚠️ " + t("chat.truncated", lang));
    } else {
      await bot.api.sendMessage(client.telegram_id, msg);
    }

    await ctx.reply(t("chat.sent_success", ctx.language));
  } catch (err) {
    console.warn(`[CHAT] Failed to send to client:`, err);
    await ctx.reply(t("chat.send_error", ctx.language));
  }

  return true;
}

export async function startCoachChat(ctx: MyContext): Promise<void> {
  if (!ctx.from?.id || ctx.from.id !== Number(COACH_CHAT_ID)) {
    await ctx.reply(t("chat.coach_only", ctx.language));
    return;
  }

  try {
    const { data: clients, error } = await supabaseAdmin
      .from("clients")
      .select("id, name, telegram_id")
      .eq("status", "active")
      .not("telegram_id", "is", null)
      .order("name");

    if (error || !clients || clients.length === 0) {
      await ctx.reply(t("chat.no_clients", ctx.language));
      return;
    }

    const lines = [t("chat.select_client", ctx.language), ""];
    const keyboard = new InlineKeyboard();
    let buttonCount = 0;

    for (const c of clients) {
      if (buttonCount >= MAX_KEYBOARD_BUTTONS) {
        lines.push(t("chat.more_clients", ctx.language, { count: clients.length - buttonCount }));
        break;
      }
      const name = c.name ?? t("greeting.default_name", ctx.language);
      const idShort = c.id.slice(0, 8);
      lines.push(`• ${name} (${idShort}...)`);
      keyboard.row().text(`${name} (${idShort})`, `chat_select:${c.id}`);
      buttonCount++;
    }

    await ctx.reply(lines.join("\n"), { reply_markup: keyboard });
  } catch (err) {
    console.error(`[CHAT] Error listing clients:`, err);
    await ctx.reply(t("error.service_unavailable", ctx.language));
  }
}

export async function handleChatSelectCallback(ctx: MyContext, clientId: string): Promise<void> {
  if (!ctx.from?.id || ctx.from.id !== Number(COACH_CHAT_ID)) {
    await ctx.answerCallbackQuery();
    return;
  }

  await ctx.answerCallbackQuery();

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, name")
    .eq("id", clientId)
    .eq("status", "active")
    .maybeSingle();

  if (!client) {
    await ctx.reply(t("chat.client_not_found", ctx.language));
    return;
  }

  try {
    await setState(ctx.from.id, {
      action: "chat",
      step: "active",
      data: { client_id: clientId },
    });
  } catch (err) {
    console.error(`[CHAT] setState failed:`, err);
    await ctx.reply(t("error.service_unavailable", ctx.language));
    return;
  }

  const name = client.name ?? clientId.slice(0, 8);
  await ctx.reply(t("chat.activated", ctx.language, { name }));
}

export async function endCoachChat(ctx: MyContext): Promise<void> {
  if (!ctx.from?.id || ctx.from.id !== Number(COACH_CHAT_ID)) return;

  try {
    await clearState(ctx.from.id);
  } catch (err) {
    console.error(`[CHAT] clearState failed:`, err);
  }

  await ctx.reply(t("chat.ended", ctx.language));
}
