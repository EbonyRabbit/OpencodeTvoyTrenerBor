import type { MyContext } from "../bot.js";
import type { Client } from "../lib/clients.js";
import { t, type Language } from "../i18n/index.js";
import { startTrainingDaysSetup } from "./training-days.js";

export function buildConnectedMessage(client: Client, lang: Language): string {
  const lines = [t("greeting.hello", lang, { name: client.name ?? t("greeting.default_name", lang) })];

  if (!client.program_id) {
    lines.push(t("client.no_program", lang));
  } else {
    lines.push(t("menu.title", lang));
    lines.push(t("menu.today", lang));
    lines.push(t("menu.myprogram", lang));
  }

  return lines.join("\n");
}

export function needsScheduleSetup(client: Client): boolean {
  return !!client.program_id && (client.training_days ?? []).length === 0;
}

export async function runAfterConnect(ctx: MyContext): Promise<void> {
  const client = ctx.client;
  if (!client) return;

  await ctx.reply(buildConnectedMessage(client, ctx.language));
  if (needsScheduleSetup(client)) {
    await startTrainingDaysSetup(ctx);
  }
}