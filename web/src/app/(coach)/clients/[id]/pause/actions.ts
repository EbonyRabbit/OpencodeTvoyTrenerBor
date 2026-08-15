"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import {
  createPause as serviceCreatePause,
  resumePlan as serviceResumePlan,
  getActivePause as serviceGetActivePause,
  getPauseHistory as serviceGetPauseHistory,
  suggestStrategy,
} from "@/lib/plan-adjustment";
import type { PauseReason, ResumeStrategy, PlanPause } from "@/lib/plan-adjustment";

export async function pauseClientPlan(
  clientId: string,
  pauseStart: string,
  reason: PauseReason,
  pauseEnd?: string | null,
): Promise<{ error?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }

    const result = await serviceCreatePause(clientId, pauseStart, reason, null, pauseEnd);
    if (result.error) return result;

    revalidatePath(`/clients/${clientId}`);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

export async function resumeClientPlan(
  clientId: string,
  resumeDate: string,
  strategy: ResumeStrategy,
): Promise<{ error?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }

    const result = await serviceResumePlan(clientId, resumeDate, strategy);
    if (result.error) return result;

    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/clients/${clientId}/workouts`);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

export async function getActivePause(clientId: string): Promise<{
  pause: PlanPause | null;
  error?: string;
}> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { pause: null, error: "Нет прав" };
    }

    const pause = await serviceGetActivePause(clientId);
    return { pause };
  } catch (e) {
    return {
      pause: null,
      error: e instanceof Error ? e.message : "Произошла ошибка",
    };
  }
}

export async function getPauseHistory(clientId: string): Promise<{
  pauses: PlanPause[];
  error?: string;
}> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { pauses: [], error: "Нет прав" };
    }

    const pauses = await serviceGetPauseHistory(clientId);
    return { pauses };
  } catch (e) {
    return {
      pauses: [],
      error: e instanceof Error ? e.message : "Произошла ошибка",
    };
  }
}

export async function getSuggestedStrategy(clientId: string): Promise<{
  strategy: ResumeStrategy;
  durationDays: number;
  error?: string;
}> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { strategy: "skip", durationDays: 0, error: "Нет прав" };
    }

    const pause = await serviceGetActivePause(clientId);
    if (!pause) {
      return { strategy: "skip", durationDays: 0 };
    }

    const end = new Date().toISOString().split("T")[0];
    const start = pause.pause_start;
    const duration = Math.round(
      (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24),
    ) + 1;

    return {
      strategy: suggestStrategy(duration),
      durationDays: Math.max(0, duration),
    };
  } catch (e) {
    return {
      strategy: "skip",
      durationDays: 0,
      error: e instanceof Error ? e.message : "Произошла ошибка",
    };
  }
}
