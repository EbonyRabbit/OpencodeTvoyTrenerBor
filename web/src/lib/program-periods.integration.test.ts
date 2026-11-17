import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { startProgramPeriod, getActiveProgramPeriod } from "@/lib/program-periods";
import { dbDate, resetDb } from "@/test/integration/db";
import type { Database } from "@/types/supabase";

type PeriodRow =
  Database["public"]["Tables"]["client_program_periods"]["Row"];

async function seedClient(programId: string | null = null) {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .insert({
      name: `Клиент ${randomUUID().slice(0, 8)}`,
      language: "ru",
      timezone: "UTC",
      program_id: programId,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("client seed failed");
  return data.id;
}

async function seedProgram(active = true) {
  const { data, error } = await supabaseAdmin
    .from("programs")
    .insert({
      title: `Программа ${randomUUID().slice(0, 8)}`,
      price: 4900,
      duration_weeks: 4,
      active,
      type: "template",
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("program seed failed");
  return data.id;
}

async function seedActivePeriod(clientId: string, programId: string) {
  const { data, error } = await supabaseAdmin
    .from("client_program_periods")
    .insert({ client_id: clientId, program_id: programId, status: "active" })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("period seed failed");
  return data.id;
}

function scheduleEntries() {
  return [
    {
      week_number: 1,
      sheet_name: "W1",
      is_deload: false,
      start_date: "2026-11-16",
      end_date: "2026-11-22",
      original_start_date: "2026-11-16",
      original_end_date: "2026-11-22",
      focus: "База",
      status: "active",
      training_days: [1, 3, 5],
    },
    {
      week_number: 2,
      sheet_name: "W2",
      is_deload: true,
      start_date: "2026-11-23",
      end_date: "2026-11-29",
      original_start_date: "2026-11-23",
      original_end_date: "2026-11-29",
      focus: null,
      status: "active",
      training_days: null,
    },
  ];
}

beforeEach(() => {
  resetDb();
});

describe("start_program_period on real data", () => {
  it("closes the old period, creates a new one and points the client at the program", async () => {
    const programId = await seedProgram();
    const otherProgramId = await seedProgram();
    const clientId = await seedClient(programId);
    const oldPeriodId = await seedActivePeriod(clientId, programId);

    const { error } = await supabaseAdmin.rpc("start_program_period", {
      p_client_id: clientId,
      p_program_id: otherProgramId,
      p_schedule: scheduleEntries(),
    });
    expect(error).toBeNull();

    const { data: periods } = await supabaseAdmin
      .from("client_program_periods")
      .select("*")
      .eq("client_id", clientId)
      .order("started_at", { ascending: true });
    const rows = periods as PeriodRow[];
    expect(rows).toHaveLength(2);
    const closed = rows.find((p) => p.id === oldPeriodId);
    const fresh = rows.find((p) => p.id !== oldPeriodId);
    expect(closed?.status).toBe("completed");
    expect(closed?.ended_at).toBeTruthy();
    expect(fresh?.status).toBe("active");
    expect(fresh?.ended_at).toBeNull();
    expect(fresh?.program_id).toBe(otherProgramId);

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("program_id")
      .eq("id", clientId)
      .single();
    expect(client?.program_id).toBe(otherProgramId);
  });

  it("archives the old schedule and stamps new rows with program and period", async () => {
    const programId = await seedProgram();
    const clientId = await seedClient(programId);
    await seedActivePeriod(clientId, programId);
    await supabaseAdmin
      .from("program_schedule")
      .insert({ client_id: clientId, week_number: 1, status: "active" });

    const { error } = await supabaseAdmin.rpc("start_program_period", {
      p_client_id: clientId,
      p_program_id: programId,
      p_schedule: scheduleEntries(),
    });
    expect(error).toBeNull();

    const { data: schedule } = await supabaseAdmin
      .from("program_schedule")
      .select("*")
      .eq("client_id", clientId)
      .order("created_at", { ascending: true });

    expect(schedule).toHaveLength(3);
    const archived = schedule?.filter((w) => w.status === "archived") ?? [];
    const fresh = schedule?.filter((w) => w.status === "active") ?? [];
    expect(archived).toHaveLength(1);
    expect(fresh).toHaveLength(2);
    expect(fresh.every((w) => w.program_id === programId)).toBe(true);
    expect(fresh.every((w) => w.program_period_id)).toBe(true);
    expect(fresh[0]?.week_number).toBe(1);
    expect(fresh[0]?.training_days).toEqual([1, 3, 5]);
    expect(fresh[0]?.is_deload).toBe(false);
    expect(fresh[1]?.is_deload).toBe(true);
    expect(fresh[1]?.training_days).toBeNull();
    expect(archived[0]?.program_period_id).toBeNull();
    expect(archived[0]?.program_id).toBeNull();
  });

  it("closes active plan pauses on the switch", async () => {
    const programId = await seedProgram();
    const clientId = await seedClient(programId);
    await seedActivePeriod(clientId, programId);
    const { error: pauseError } = await supabaseAdmin
      .from("plan_pauses")
      .insert({ client_id: clientId, pause_start: "2026-11-10", status: "active" });
    expect(pauseError).toBeNull();

    const { error } = await supabaseAdmin.rpc("start_program_period", {
      p_client_id: clientId,
      p_program_id: programId,
      p_schedule: scheduleEntries(),
    });
    expect(error).toBeNull();

    const { data: pauses } = await supabaseAdmin
      .from("plan_pauses")
      .select("status, pause_end")
      .eq("client_id", clientId);
    expect(pauses).toHaveLength(1);
    expect(pauses?.[0]?.status).toBe("completed");
    expect(pauses?.[0]?.pause_end).toBe(dbDate());
  });

  it("keeps old logs and re-stamps pre-period logs onto the closing period", async () => {
    const programId = await seedProgram();
    const clientId = await seedClient(programId);
    const oldPeriodId = await seedActivePeriod(clientId, programId);

    const { error: logError } = await supabaseAdmin
      .from("workout_logs")
      .insert([
        { client_id: clientId, date: "2026-11-05", exercise: "Присед", program_period_id: oldPeriodId },
        { client_id: clientId, date: "2026-11-06", exercise: "Жим" },
      ]);
    expect(logError).toBeNull();

    const { error } = await supabaseAdmin.rpc("start_program_period", {
      p_client_id: clientId,
      p_program_id: programId,
      p_schedule: scheduleEntries(),
    });
    expect(error).toBeNull();

    const { data: logs } = await supabaseAdmin
      .from("workout_logs")
      .select("id, exercise, program_id, program_period_id")
      .eq("client_id", clientId);
    expect(logs).toHaveLength(2);
    const stamped = logs?.find((l) => l.exercise === "Жим");
    const known = logs?.find((l) => l.exercise === "Присед");
    expect(stamped?.program_period_id).toBe(oldPeriodId);
    expect(stamped?.program_id).toBe(programId);
    expect(known?.program_period_id).toBe(oldPeriodId);
  });

  it("rejects an unknown client or inactive program", async () => {
    const programId = await seedProgram();
    const inactiveId = await seedProgram(false);

    const missing = await supabaseAdmin.rpc("start_program_period", {
      p_client_id: randomUUID(),
      p_program_id: programId,
    });
    expect(missing.error).toBeTruthy();

    const { data: client } = await supabaseAdmin
      .from("clients")
      .insert({
        name: "Клиент",
        language: "ru",
        timezone: "UTC",
      })
      .select("id")
      .single();

    const inactive = await supabaseAdmin.rpc("start_program_period", {
      p_client_id: client!.id,
      p_program_id: inactiveId,
    });
    expect(inactive.error).toBeTruthy();
  });

  it("enforces period integrity constraints", async () => {
    const programId = await seedProgram();
    const clientId = await seedClient(programId);
    const periodId = await seedActivePeriod(clientId, programId);

    const { error: endedActive } = await supabaseAdmin
      .from("client_program_periods")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", periodId);
    expect(endedActive?.code).toBe("23514");

    await supabaseAdmin
      .from("client_program_periods")
      .update({ status: "completed", ended_at: new Date().toISOString() })
      .eq("id", periodId);
    const { error: noEnd } = await supabaseAdmin
      .from("client_program_periods")
      .update({ ended_at: null })
      .eq("id", periodId);
    expect(noEnd?.code).toBe("23514");

    await supabaseAdmin
      .from("client_program_periods")
      .update({ ended_at: "2020-01-01T00:00:00Z" })
      .eq("id", periodId);
    const { error: order } = await supabaseAdmin
      .from("client_program_periods")
      .update({ status: "active" })
      .eq("id", periodId);
    expect(order?.code).toBe("23514");
  });

  it("wrapper refuses a program without weeks before touching the database", async () => {
    const programId = await seedProgram();
    const clientId = await seedClient(programId);

    const { error } = await startProgramPeriod(clientId, programId);
    expect(error).toContain("нет недель");

    const { data: periods } = await supabaseAdmin
      .from("client_program_periods")
      .select("id")
      .eq("client_id", clientId);
    expect(periods).toHaveLength(0);
  });

  it("closes resuming plan pauses too (30.6 tail)", async () => {
    const programId = await seedProgram();
    const clientId = await seedClient(programId);
    await seedActivePeriod(clientId, programId);
    const { error: pauseError } = await supabaseAdmin
      .from("plan_pauses")
      .insert({ client_id: clientId, pause_start: "2026-11-10", status: "resuming" });
    expect(pauseError).toBeNull();

    const { error } = await supabaseAdmin.rpc("start_program_period", {
      p_client_id: clientId,
      p_program_id: programId,
      p_schedule: scheduleEntries(),
    });
    expect(error).toBeNull();

    const { data: pauses } = await supabaseAdmin
      .from("plan_pauses")
      .select("status, pause_end")
      .eq("client_id", clientId);
    expect(pauses).toHaveLength(1);
    expect(pauses?.[0]?.status).toBe("completed");
    expect(pauses?.[0]?.pause_end).toBe(dbDate());
  });
});

describe("getActiveProgramPeriod on real data", () => {
  it("returns the single active period and null when there is none", async () => {
    const programId = await seedProgram();
    const clientId = await seedClient(programId);

    expect(await getActiveProgramPeriod(clientId)).toBeNull();

    await seedActivePeriod(clientId, programId);
    const period = await getActiveProgramPeriod(clientId);
    expect(period?.program_id).toBe(programId);
  });

  it("points at the new program after a switch", async () => {
    const programId = await seedProgram();
    const clientId = await seedClient(programId);
    await seedActivePeriod(clientId, programId);

    const nextProgramId = await seedProgram();
    const { error } = await supabaseAdmin.rpc("start_program_period", {
      p_client_id: clientId,
      p_program_id: nextProgramId,
      p_schedule: scheduleEntries(),
    });
    expect(error).toBeNull();

    const period = await getActiveProgramPeriod(clientId);
    expect(period?.program_id).toBe(nextProgramId);

    const { data: periods } = await supabaseAdmin
      .from("client_program_periods")
      .select("status, program_id")
      .eq("client_id", clientId)
      .order("started_at");
    expect(periods).toHaveLength(2);
    expect(periods?.[0]).toMatchObject({ status: "completed", program_id: programId });
    expect(periods?.[1]).toMatchObject({ status: "active", program_id: nextProgramId });
  });
});
