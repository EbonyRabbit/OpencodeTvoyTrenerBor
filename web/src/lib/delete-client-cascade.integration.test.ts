import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { resetDb } from "@/test/integration/db";

async function seedClient(telegramId: number | null = null) {
  const id = randomUUID();
  const { error } = await supabaseAdmin.from("clients").insert({
    id,
    name: "P0 Cascade",
    telegram_id: telegramId,
    status: "active",
  });
  if (error) throw error;
  return id;
}

async function seedPersonalProgram(clientId: string) {
  const id = randomUUID();
  const { error } = await supabaseAdmin.from("programs").insert({
    id,
    title: "Personal P0",
    type: "personal",
    client_id: clientId,
    parsed_content: { private: true },
  });
  if (error) throw error;
  return id;
}

beforeEach(() => {
  resetDb();
});

describe("delete_client_cascade", () => {
  it("removes a personal program linked only through programs.client_id", async () => {
    const clientId = await seedClient(555001);
    const programId = await seedPersonalProgram(clientId);

    await supabaseAdmin
      .from("bot_state")
      .insert({ telegram_id: 555001, client_id: clientId, action: "test" });
    await supabaseAdmin.from("bot_dedup").insert({
      key: "welcome_followup:base:555001:1",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

    const { error } = await supabaseAdmin.rpc("delete_client_cascade", {
      p_client_id: clientId,
      p_telegram_id: 555001,
    });
    expect(error).toBeNull();

    const { data: clients } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("id", clientId);
    const { data: programs } = await supabaseAdmin
      .from("programs")
      .select("id")
      .eq("id", programId);
    const { data: state } = await supabaseAdmin
      .from("bot_state")
      .select("telegram_id")
      .eq("telegram_id", 555001);
    const { data: dedup } = await supabaseAdmin
      .from("bot_dedup")
      .select("key")
      .eq("key", "welcome_followup:base:555001:1");

    expect(clients).toHaveLength(0);
    expect(programs).toHaveLength(0);
    expect(state).toHaveLength(0);
    expect(dedup).toHaveLength(0);
  });

  it("does not delete another client's personal program referenced by the deleted client", async () => {
    const ownerId = await seedClient(555004);
    const deletedId = await seedClient(555005);
    const programId = await seedPersonalProgram(ownerId);
    await supabaseAdmin
      .from("clients")
      .update({ program_id: programId })
      .eq("id", deletedId);

    const { error } = await supabaseAdmin.rpc("delete_client_cascade", {
      p_client_id: deletedId,
      p_telegram_id: 555005,
    });
    expect(error).toBeNull();

    const { data: programs } = await supabaseAdmin
      .from("programs")
      .select("id")
      .eq("id", programId);
    expect(programs).toHaveLength(1);
  });

  it("deletes the owner's program and clears invalid cross-client references", async () => {
    const firstClientId = await seedClient(555002);
    const secondClientId = await seedClient(555003);
    const programId = await seedPersonalProgram(firstClientId);
    await supabaseAdmin
      .from("clients")
      .update({ program_id: programId })
      .in("id", [firstClientId, secondClientId]);

    const { error } = await supabaseAdmin.rpc("delete_client_cascade", {
      p_client_id: firstClientId,
      p_telegram_id: 555002,
    });
    expect(error).toBeNull();

    const { data: programs } = await supabaseAdmin
      .from("programs")
      .select("id")
      .eq("id", programId);
    const { data: secondClient } = await supabaseAdmin
      .from("clients")
      .select("program_id")
      .eq("id", secondClientId)
      .single();
    expect(programs).toHaveLength(0);
    expect(secondClient?.program_id).toBeNull();
  });
});
