"use server";

import { createClient } from "@/lib/supabase-server";
import type { ActivityEvent } from "./activity-types";
import { ACTIVITY_PAGE_SIZE } from "./activity-types";

type RawWorkout = { id: string; created_at: string; exercise: string; sets: number | null; reps: string | null; weight: number | null };
type RawCheckin = { id: string; created_at: string; wellbeing: number | null; sleep: number | null; stress: number | null };
type RawMeasurement = { id: string; created_at: string; weight: number | null; waist: number | null; chest: number | null; hips: number | null };
type RawPhoto = { id: string; created_at: string; type: string };
type RawMessage = { id: string; created_at: string; direction: string; text: string };
type RawNotification = { id: string; created_at: string; type: string; status: string };

const PER_TABLE_SIZE = 15;

async function fetchPage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientId: string,
  offset: number,
): Promise<ActivityEvent[]> {
  const from = offset;
  const to = offset + PER_TABLE_SIZE - 1;

  const [workouts, checkins, measurements, photos, messages, notifications] = await Promise.all([
    supabase.from("workout_logs").select("id, created_at, exercise, sets, reps, weight").eq("client_id", clientId).order("created_at", { ascending: false }).range(from, to),
    supabase.from("checkins").select("id, created_at, wellbeing, sleep, stress").eq("client_id", clientId).order("created_at", { ascending: false }).range(from, to),
    supabase.from("measurements").select("id, created_at, weight, waist, chest, hips").eq("client_id", clientId).order("created_at", { ascending: false }).range(from, to),
    supabase.from("photos").select("id, created_at, type").eq("client_id", clientId).order("created_at", { ascending: false }).range(from, to),
    supabase.from("messages").select("id, created_at, direction, text").eq("client_id", clientId).order("created_at", { ascending: false }).range(from, to),
    supabase.from("notification_log").select("id, created_at, type, status").eq("client_id", clientId).order("created_at", { ascending: false }).range(from, to),
  ]);

  const all: ActivityEvent[] = [];

  for (const w of (workouts.data ?? []) as RawWorkout[]) {
    all.push({ id: w.id, date: w.created_at, event_type: "workout", details: { exercise: w.exercise, sets: w.sets, reps: w.reps, weight: w.weight } });
  }
  for (const c of (checkins.data ?? []) as RawCheckin[]) {
    all.push({ id: c.id, date: c.created_at, event_type: "checkin", details: { wellbeing: c.wellbeing, sleep: c.sleep, stress: c.stress } });
  }
  for (const m of (measurements.data ?? []) as RawMeasurement[]) {
    all.push({ id: m.id, date: m.created_at, event_type: "measurement", details: { weight: m.weight, waist: m.waist, chest: m.chest, hips: m.hips } });
  }
  for (const p of (photos.data ?? []) as RawPhoto[]) {
    all.push({ id: p.id, date: p.created_at, event_type: "photo", details: { type: p.type } });
  }
  for (const msg of (messages.data ?? []) as RawMessage[]) {
    all.push({ id: msg.id, date: msg.created_at, event_type: "message", details: { direction: msg.direction, preview: msg.text } });
  }
  for (const n of (notifications.data ?? []) as RawNotification[]) {
    all.push({ id: n.id, date: n.created_at, event_type: "notification", details: { type: n.type, status: n.status } });
  }

  all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return all.slice(0, ACTIVITY_PAGE_SIZE);
}

export async function getClientActivity(clientId: string): Promise<{
  events: ActivityEvent[];
  loadMore: (offset: number) => Promise<ActivityEvent[]>;
}> {
  const supabase = await createClient();
  const events = await fetchPage(supabase, clientId, 0);

  return {
    events,
    loadMore: async (offset: number) => {
      const supabaseInner = await createClient();
      return fetchPage(supabaseInner, clientId, offset);
    },
  };
}
