"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { generateSchedule } from "@/lib/plan-adjustment";
import { validateProgramContent, type ParsedContent } from "@/lib/program-utils";
import type { Database } from "@/types/supabase";

type ProgramInsert = Database["public"]["Tables"]["programs"]["Insert"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createProgram(input: {
  title: string;
  description?: string;
  equipment?: string;
  price?: number;
  duration_weeks: number;
  type?: string;
  language?: string;
}): Promise<{ id?: string; error?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }

    const title = input.title.trim();
    if (!title) return { error: "Введите название программы" };
    if (title.length > 200) return { error: "Название слишком длинное (макс. 200 символов)" };

    const durationWeeks = Number(input.duration_weeks);
    if (!Number.isFinite(durationWeeks) || !Number.isInteger(durationWeeks) || durationWeeks < 1 || durationWeeks > 52) {
      return { error: "Длительность должна быть целым числом от 1 до 52 недель" };
    }

    const validTypes = ["template", "personal"];
    const type = input.type && validTypes.includes(input.type) ? input.type : "template";
    const language = input.language === "en" ? "en" : "ru";

    const insertData: ProgramInsert = {
      title,
      description: input.description?.trim() || null,
      equipment: input.equipment?.trim() || null,
      price: typeof input.price === "number" && Number.isFinite(input.price) && input.price >= 0 ? input.price : null,
      duration_weeks: durationWeeks,
      type: type as "template" | "personal",
      language,
      active: false,
      parsed_content: null,
      template_id: null,
      template_file_url: null,
      client_id: null,
    };

    const { data, error } = await supabaseAdmin
      .from("programs")
      .insert(insertData)
      .select("id")
      .single();

    if (error) {
      console.error("createProgram insert error:", error.message);
      return { error: error.message };
    }
    if (!data) return { error: "Не удалось создать программу" };

    revalidatePath("/programs");
    return { id: data.id };
  } catch (e) {
    console.error("createProgram error:", e);
    return { error: "Произошла ошибка" };
  }
}

export async function updateProgramPrice(
  programId: string,
  price: number | null,
): Promise<{ error?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }

    if (!UUID_RE.test(programId)) return { error: "Некорректный идентификатор" };

    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      return { error: "Некорректная цена" };
    }

    const { data: program, error: fetchError } = await supabaseAdmin
      .from("programs")
      .select("id")
      .eq("id", programId)
      .maybeSingle();
    if (fetchError) return { error: fetchError.message };
    if (!program) return { error: "Программа не найдена" };

    const { error } = await supabaseAdmin
      .from("programs")
      .update({ price, updated_at: new Date().toISOString() })
      .eq("id", programId);
    if (error) return { error: error.message };

    revalidatePath(`/programs/${programId}`);
    revalidatePath("/programs");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

export async function toggleProgramStatus(
  programId: string,
  newActive: boolean,
): Promise<{ error?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }

    if (!UUID_RE.test(programId)) {
      return { error: "Некорректный ID программы" };
    }

    const { data: program, error: fetchError } = await supabaseAdmin
      .from("programs")
      .select("id, active, parsed_content, title")
      .eq("id", programId)
      .maybeSingle();

    if (fetchError) return { error: fetchError.message };
    if (!program) return { error: "Программа не найдена" };

    if (program.active === newActive) {
      return {};
    }

    if (newActive && !program.parsed_content) {
      return { error: "Нельзя опубликовать программу без содержимого" };
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("programs")
      .update({ active: newActive })
      .eq("id", programId)
      .select("id");

    if (updateError) return { error: updateError.message };
    if (!updated || updated.length === 0) return { error: "Программа не найдена" };

    revalidatePath(`/programs/${programId}`);
    revalidatePath("/programs");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

export async function getAssignableClients(): Promise<{
  clients: Array<{ id: string; name: string; program_id: string | null }>;
  error?: string;
}> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { clients: [], error: "Нет прав" };
    }

    const { data, error } = await supabaseAdmin
      .from("clients")
      .select("id, name, program_id")
      .order("name");

    if (error) return { clients: [], error: error.message };

    return { clients: data ?? [] };
  } catch (e) {
    return {
      clients: [],
      error: e instanceof Error ? e.message : "Произошла ошибка",
    };
  }
}

export async function assignToClient(
  programId: string,
  clientId: string,
): Promise<{ error?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }

    if (!UUID_RE.test(programId)) {
      return { error: "Некорректный ID программы" };
    }
    if (!UUID_RE.test(clientId)) {
      return { error: "Некорректный ID клиента" };
    }

    const { data: program, error: programError } = await supabaseAdmin
      .from("programs")
      .select("id, active")
      .eq("id", programId)
      .maybeSingle();

    if (programError) return { error: programError.message };
    if (!program) return { error: "Программа не найдена" };
    if (!program.active) {
      return { error: "Программа не опубликована. Сначала опубликуйте программу." };
    }

    const { data: client, error: clientError } = await supabaseAdmin
      .from("clients")
      .select("id, name")
      .eq("id", clientId)
      .maybeSingle();

    if (clientError) return { error: clientError.message };
    if (!client) return { error: "Клиент не найден" };

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("clients")
      .update({ program_id: programId, status: "active" })
      .eq("id", clientId)
      .is("program_id", null)
      .select("id");

    if (updateError) return { error: updateError.message };
    if (!updated || updated.length === 0) {
      return { error: `У клиента "${client.name}" уже есть программа. Сначала отключите текущую.` };
    }

    const scheduleError = await generateSchedule(clientId, programId);
    if (scheduleError.error) {
      return { error: `Программа назначена, но не удалось создать расписание: ${scheduleError.error}` };
    }

    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/programs/${programId}`);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

export async function deleteProgram(
  programId: string,
): Promise<{ error?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }

    if (!UUID_RE.test(programId)) {
      return { error: "Некорректный ID программы" };
    }

    const { data: program, error: fetchError } = await supabaseAdmin
      .from("programs")
      .select("id, title")
      .eq("id", programId)
      .maybeSingle();

    if (fetchError) return { error: fetchError.message };
    if (!program) return { error: "Программа не найдена" };

    const { count: assignedClients } = await supabaseAdmin
      .from("clients")
      .select("*", { count: "exact", head: true })
      .eq("program_id", programId);

    if (assignedClients && assignedClients > 0) {
      return { error: `Нельзя удалить — программа назначена ${assignedClients} клиент${assignedClients === 1 ? "у" : "ам"}` };
    }

    const { error: deleteError } = await supabaseAdmin
      .from("programs")
      .delete()
      .eq("id", programId);

    if (deleteError) return { error: deleteError.message };

    revalidatePath("/programs");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}

export async function updateProgramContent(
  programId: string,
  content: ParsedContent,
): Promise<{ error?: string }> {
  try {
    const { profile } = await verifySession();
    if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
      return { error: "Нет прав" };
    }

    if (!UUID_RE.test(programId)) {
      return { error: "Некорректный ID программы" };
    }

    const validation = validateProgramContent(content);
    if (!validation.valid) {
      return { error: validation.error };
    }

    const { data: program, error: fetchError } = await supabaseAdmin
      .from("programs")
      .select("id, updated_at")
      .eq("id", programId)
      .maybeSingle();

    if (fetchError) return { error: fetchError.message };
    if (!program) return { error: "Программа не найдена" };

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("programs")
      .update({ parsed_content: content })
      .eq("id", programId)
      .eq("updated_at", program.updated_at)
      .select("id");

    if (updateError) return { error: updateError.message };
    if (!updated || updated.length === 0) {
      return { error: "Программа была изменена другим пользователем. Обновите страницу." };
    }

    revalidatePath(`/programs/${programId}`);
    revalidatePath(`/programs/${programId}/edit`);
    revalidatePath("/programs");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Произошла ошибка" };
  }
}
