import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/dal", () => ({
  verifySession: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { verifySession } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { revalidatePath } from "next/cache";
import { createExercise, updateExercise, deleteExercise } from "../actions";

const UUID = "11111111-2222-3333-4444-555555555555";
const VALID_DATA = {
  name: "Жим лёжа",
  aliases: ["Bench Press", "жим штанги лёжа"],
  descriptionRu: "",
  descriptionEn: "",
  techniqueRu: "Шаг 1",
  techniqueEn: "",
  featuresRu: ["Лопатки прижаты"],
  featuresEn: [],
  videoUrl: "",
  muscleGroup: "Грудь",
  equipment: "Штанга",
  difficulty: "beginner",
  contraindications: "",
};

function mockTable(defaultResult: { error: { code?: string; message: string } | null; data?: unknown }) {
  const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  const chain = {
    select: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(defaultResult)),
    maybeSingle: vi.fn(() => Promise.resolve(defaultResult)),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    then: (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve(defaultResult).then(onFulfilled),
  };
  fake.from.mockImplementation((table: string) => {
    if (table === "exercises") return chain;
    throw new Error(`Unexpected table: ${table}`);
  });
  return chain;
}

function mockErrorResult(code?: string) {
  return { error: { code: code ?? "23505", message: "duplicate" }, data: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  (verifySession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    profile: { role: "admin" },
  });
});

describe("createExercise", () => {
  it("rejects non-admin/coach roles", async () => {
    (verifySession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      profile: { role: "client" },
    });
    const result = await createExercise(VALID_DATA);
    expect(result.error).toBe("Нет прав");
  });

  it("accepts coach role", async () => {
    (verifySession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      profile: { role: "coach" },
    });
    mockTable({ error: null, data: { id: UUID } });
    const result = await createExercise(VALID_DATA);
    expect(result.error).toBeUndefined();
  });

  it("rejects empty names", async () => {
    const result = await createExercise({ ...VALID_DATA, name: "   " });
    expect(result.error).toBe("Название обязательно");
  });

  it("normalizes ё to е in name_key", async () => {
    const chain = mockTable({ error: null, data: { id: UUID } });
    await createExercise({ ...VALID_DATA, name: "Подъём на ёлку" });
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name_key: "подъемнаелку" }),
    );
  });

  it("rejects non-https video urls", async () => {
    const result = await createExercise({ ...VALID_DATA, videoUrl: "ftp://x" });
    expect(result.error).toContain("https");
    const httpResult = await createExercise({ ...VALID_DATA, videoUrl: "http://youtube.com/watch?v=x" });
    expect(httpResult.error).toContain("https");
  });

  it("rejects unknown difficulty values", async () => {
    const result = await createExercise({ ...VALID_DATA, difficulty: "superhard" });
    expect(result.error).toBe("Недопустимое значение сложности");
  });

  it("rejects over-long text instead of truncating it", async () => {
    const result = await createExercise({
      ...VALID_DATA,
      techniqueRu: "x".repeat(4001),
    });
    expect(result.error).toContain("Техника (RU)");
    expect(result.error).toContain("4000");
  });

  it("rejects over-long array items", async () => {
    const result = await createExercise({
      ...VALID_DATA,
      aliases: ["x".repeat(201)],
    });
    expect(result.error).toContain("Алиасы");
  });

  it("rejects non-string array items instead of crashing", async () => {
    const result = await createExercise({
      ...VALID_DATA,
      aliases: ["Ок", 123 as unknown as string],
    });
    expect(result.error).toBe("Некорректные данные формы");
  });

  it("rejects over-long video urls", async () => {
    const result = await createExercise({
      ...VALID_DATA,
      videoUrl: `https://youtu.be/${"x".repeat(500)}`,
    });
    expect(result.error).toContain("500");
  });

  it("inserts normalized payload on success", async () => {
    const chain = mockTable({ error: null, data: { id: UUID } });
    const result = await createExercise(VALID_DATA);
    expect(result.error).toBeUndefined();
    expect(result.id).toBe(UUID);
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Жим лёжа",
        name_key: "жимлежа",
        aliases: ["Bench Press", "жим штанги лёжа"],
        features_ru: ["Лопатки прижаты"],
        video_url: null,
        description_ru: null,
        technique_ru: "Шаг 1",
        difficulty: "beginner",
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/exercises");
  });

  it("maps duplicate key errors to a friendly message", async () => {
    mockTable(mockErrorResult("23505"));
    const result = await createExercise(VALID_DATA);
    expect(result.error).toBe("Упражнение с таким названием уже есть в библиотеке");
  });
});

describe("updateExercise", () => {
  it("rejects invalid ids", async () => {
    const result = await updateExercise("not-a-uuid", VALID_DATA);
    expect(result.error).toBe("Некорректный идентификатор");
  });

  it("updates the row by id", async () => {
    const chain = mockTable({ error: null, data: { id: UUID } });
    const result = await updateExercise(UUID, VALID_DATA);
    expect(result.error).toBeUndefined();
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ name_key: "жимлежа", updated_at: expect.any(String) }),
    );
    expect(chain.eq).toHaveBeenCalledWith("id", UUID);
    expect(revalidatePath).toHaveBeenCalledWith("/exercises");
  });

  it("reports missing rows as not found", async () => {
    mockTable({ error: null, data: null });
    const result = await updateExercise(UUID, VALID_DATA);
    expect(result.error).toBe("Упражнение не найдено");
  });

  it("applies validation on update too", async () => {
    mockTable({ error: null, data: { id: UUID } });
    const result = await updateExercise(UUID, { ...VALID_DATA, name: "" });
    expect(result.error).toBe("Название обязательно");
  });

  it("maps duplicate key errors on update", async () => {
    mockTable(mockErrorResult("23505"));
    const result = await updateExercise(UUID, VALID_DATA);
    expect(result.error).toBe("Упражнение с таким названием уже есть в библиотеке");
  });
});

describe("deleteExercise", () => {
  it("rejects invalid ids", async () => {
    const result = await deleteExercise("nope");
    expect(result.error).toBe("Некорректный идентификатор");
  });

  it("deletes the row by id", async () => {
    const chain = mockTable({ error: null, data: { id: UUID } });
    const result = await deleteExercise(UUID);
    expect(result.error).toBeUndefined();
    expect(chain.delete).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith("id", UUID);
    expect(revalidatePath).toHaveBeenCalledWith("/exercises");
  });

  it("reports missing rows as not found", async () => {
    mockTable({ error: null, data: null });
    const result = await deleteExercise(UUID);
    expect(result.error).toBe("Упражнение не найдено");
  });
});