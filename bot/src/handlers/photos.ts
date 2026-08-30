// DISABLED: photo storage removed - photos are saved by clients on their own devices
// Original file preserved for reference in case photo storage is re-enabled later

/*
import type { MyContext } from "../bot.js";
import { t, type Language } from "../i18n/index.js";
import { setState, clearState } from "../state/machine.js";
import { type Client } from "../lib/clients.js";
import { getTelegramFile, downloadTelegramFile, uploadPhotoToStorage, savePhotoRecord, getLatestPhotoSets, getPhotoDownloadUrl } from "../lib/photo-utils.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { getTodayDateStr } from "../lib/workout-utils.js";
import { DEFAULT_TIMEZONE } from "../lib/constants.js";

const PHOTO_STEPS = ["front", "side", "back"] as const;

type PhotoStep = (typeof PHOTO_STEPS)[number];

interface PhotoData {
  front?: string;
  side?: string;
  back?: string;
}

const STEP_INDEX = new Map<PhotoStep, number>(
  PHOTO_STEPS.map((s, i) => [s, i]),
);

function getStepPrompt(step: PhotoStep, lang: Language): string {
  return t(`photo.step_${step}` as "photo.step_front", lang);
}

function getNextStep(current: PhotoStep): PhotoStep | null {
  const idx = STEP_INDEX.get(current);
  if (idx == null || idx >= PHOTO_STEPS.length - 1) return null;
  return PHOTO_STEPS[idx + 1];
}

export async function startPhotos(ctx: MyContext): Promise<void> {
  if (!ctx.from?.id) {
    await ctx.reply(t("error.user_not_identified", ctx.language));
    return;
  }

  const client = ctx.client;
  if (!client) {
    await ctx.reply(t("error.user_not_identified", ctx.language));
    return;
  }

  const lang = (client.language || "ru") as Language;

  try {
    await setState(ctx.from.id, {
      action: "photos",
      step: "front",
      data: {},
    });
  } catch (err) {
    console.error(`[PHOTOS] setState failed for ${ctx.from.id}:`, err);
    await ctx.reply(t("error.service_unavailable", lang));
    return;
  }

  await ctx.reply(`${t("photo.title", lang)}\n\n${getStepPrompt("front", lang)}`);
}

export async function handlePhotoMessage(ctx: MyContext): Promise<void> {
  const client = ctx.client;
  if (!client || !ctx.from?.id) {
    await ctx.reply(t("error.user_not_identified", ctx.language));
    return;
  }

  const state = ctx.state;
  if (!state || state.action !== "photos" || !state.step) return;

  if (!STEP_INDEX.has(state.step as PhotoStep)) {
    await ctx.reply(t("error.service_unavailable", ctx.language));
    await clearState(ctx.from.id);
    return;
  }

  const lang = (client.language || "ru") as Language;
  const currentStep = state.step as PhotoStep;

  const photo = ctx.message?.photo;
  if (!photo || photo.length === 0) {
    await ctx.reply(t("photo.send_photo", lang));
    return;
  }

  const largest = photo.at(-1);
  if (!largest) {
    await ctx.reply(t("photo.send_photo", lang));
    return;
  }

  try {
    const fileInfo = await getTelegramFile(largest.file_id);
    const fileBuffer = await downloadTelegramFile(fileInfo.file_path);

    const week = await getCurrentWeek(client);
    const tz = client.timezone || DEFAULT_TIMEZONE;
    const storagePath = await uploadPhotoToStorage(client.id, week, currentStep, fileBuffer, tz);
    await savePhotoRecord(client.id, week, currentStep, storagePath, tz);

    const data = { ...(state.data as PhotoData), [currentStep]: storagePath };
    const nextStep = getNextStep(currentStep);

    if (!nextStep) {
      await completePhotos(ctx, client, lang);
      return;
    }

    try {
      await setState(ctx.from.id, {
        action: "photos",
        step: nextStep,
        data,
      });
    } catch (err) {
      console.error(`[PHOTOS] setState failed for ${ctx.from.id}:`, err);
      await ctx.reply(t("error.service_unavailable", lang));
      return;
    }

    await ctx.reply(`${t("photo.saved", lang)}\n\n${getStepPrompt(nextStep, lang)}`);
  } catch (err) {
    console.error(`[PHOTOS] Failed to process photo for ${client.id}:`, err);
    await ctx.reply(t("error.service_unavailable", lang));
  }
}

async function completePhotos(
  ctx: MyContext,
  client: Client,
  lang: Language,
): Promise<void> {
  try {
    await ctx.reply(t("photo.all_done", lang));
  } finally {
    try {
      await clearState(ctx.from!.id);
    } catch (err) {
      console.error(`[PHOTOS] clearState failed:`, err);
    }
  }
}

async function getCurrentWeek(client: Client): Promise<number | null> {
  if (!client.program_id) return null;

  const tz = client.timezone || DEFAULT_TIMEZONE;
  const todayStr = getTodayDateStr(tz);

  const { data } = await supabaseAdmin
    .from("program_schedule")
    .select("week_number")
    .eq("client_id", client.id)
    .lte("start_date", todayStr)
    .gte("end_date", todayStr)
    .limit(1)
    .single();

  return data?.week_number ?? null;
}

const PHOTO_TYPE_LABELS: Record<string, string> = {
  front: "photo.history_front",
  side: "photo.history_side",
  back: "photo.history_back",
};

function daysBetweenDates(a: string, b: string): number {
  const dA = new Date(a);
  const dB = new Date(b);
  if (isNaN(dA.getTime()) || isNaN(dB.getTime())) return 0;
  return Math.round((dB.getTime() - dA.getTime()) / (1000 * 60 * 60 * 24));
}

export async function showPhotoHistory(ctx: MyContext): Promise<void> {
  const client = ctx.client;
  if (!client) {
    await ctx.reply(t("error.user_not_identified", ctx.language));
    return;
  }

  const lang = (client.language || "ru") as Language;

  try {
    const photoSets = await getLatestPhotoSets(client.id, 5);

    if (photoSets.length === 0) {
      await ctx.reply(t("photo.history_empty", lang));
      return;
    }

    const now = new Date().toISOString().slice(0, 10);

    for (const set of photoSets) {
      const days = daysBetweenDates(set.date, now);
      const daysLabel = days > 0 ? ` ${t("photo.history_days_ago", lang, { days: String(days) })}` : "";
      await ctx.reply(`${t("photo.history_date", lang, { date: set.date })}${daysLabel}`);

      for (const photo of set.photos) {
        const path = photo.storage_path;
        if (!path) continue;

        try {
          const signedUrl = await getPhotoDownloadUrl(path);
          const typeLabel = t((PHOTO_TYPE_LABELS[photo.type] ?? "photo.history_front") as "photo.history_front", lang);
          await ctx.replyWithPhoto(signedUrl, { caption: typeLabel });
        } catch (err) {
          console.warn(`[PHOTOS] Failed to send photo ${photo.type} for ${client.id}:`, err);
        }
      }
    }
  } catch (err) {
    console.error(`[PHOTOS] showPhotoHistory error for ${client.id}:`, err);
    await ctx.reply(t("photo.history_error", lang));
  }
}
*/
