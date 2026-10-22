import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    telegram: { botToken: "test", webhookSecret: "test" },
    supabase: { url: "http://localhost:54321", serviceRoleKey: "test" },
    coachChatId: 0n,
    nodeEnv: "test",
    port: 3001,
    webhookPath: "/webhook",
    publicUrl: "",
  },
}));

vi.mock("../../lib/supabase-admin.js", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { supabaseAdmin } from "../../lib/supabase-admin.js";
import { clearExerciseLibraryCache } from "../exercise-library-cache.js";
import {
  normalizeExerciseKey,
  getClientSwaps,
  saveSwap,
  revertSwap,
  applySwapsToExercises,
  findSwapCandidates,
} from "../exercise-swaps.js";
import type { ParsedExercise } from "../../lib/program-utils.js";

function chain(result: { data: unknown; error: null }) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "or", "limit", "delete", "upsert"]) {
    c[m] = vi.fn().mockReturnValue(c);
  }
  c.then = (cb: (v: unknown) => unknown) => Promise.resolve(result).then(cb);
  return c;
}

function mockFrom(result: { data: unknown; error: null }) {
  const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
  fromMock.from.mockReturnValue(chain(result));
  return fromMock.from;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearExerciseLibraryCache();
});

describe("normalizeExerciseKey", () => {
  it("lowercases, trims, ё→е, strips punctuation", () => {
    expect(normalizeExerciseKey("  Приседания со штангой! ")).toBe("приседаниясоштангой");
    expect(normalizeExerciseKey("Жим НОГАМИ")).toBe("жимногами");
  });
});

describe("applySwapsToExercises", () => {
  const day: ParsedExercise[] = [
    { name: "Приседания со штангой", sets: "4", reps: "8", weight: "80" },
    { name: "Жим лёжа", sets: "3", reps: "10" },
  ];

  it("replaces name, keeps sets/reps/weight", () => {
    const out = applySwapsToExercises(day, new Map([["приседаниясоштангой", "Жим ногами"]]));
    expect(out[0].name).toBe("Жим ногами");
    expect(out[0].sets).toBe("4");
    expect(out[0].reps).toBe("8");
    expect(out[0].weight).toBe("80");
    expect(out[1].name).toBe("Жим лёжа");
  });

  it("replaces superset children, keeps container", () => {
    const sup: ParsedExercise[] = [
      { name: "Суперсет A", type: "superset", children: [{ name: "Приседания со штангой", sets: "3" }] },
    ];
    const out = applySwapsToExercises(sup, new Map([["приседаниясоштангой", "Жим ногами"]]));
    expect(out[0].name).toBe("Суперсет A");
    expect(out[0].children?.[0].name).toBe("Жим ногами");
    expect(out[0].children?.[0].sets).toBe("3");
  });

  it("returns same ref when no swaps", () => {
    expect(applySwapsToExercises(day, new Map())).toBe(day);
  });

  it("does not mutate canon", () => {
    applySwapsToExercises(day, new Map([["приседаниясоштангой", "Жим ногами"]]));
    expect(day[0].name).toBe("Приседания со штангой");
  });
});

describe("getClientSwaps", () => {
  it("builds key→replacement map", async () => {
    mockFrom({ data: [{ exercise_key: "приседаниясоштангой", replacement_name: "Жим ногами" }], error: null });
    const map = await getClientSwaps("client-1");
    expect(map.get("приседаниясоштангой")).toBe("Жим ногами");
  });

  it("returns empty map on db error", async () => {
    const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    fromMock.from.mockReturnValue(chain({ data: null, error: { message: "boom" } } as never));
    expect(await getClientSwaps("client-1")).toEqual(new Map());
  });
});

describe("saveSwap / revertSwap", () => {
  it("upserts on conflict client+key", async () => {
    const from = mockFrom({ data: null, error: null });
    await saveSwap("client-1", "Приседания со штангой", "  Жим ногами ");
    expect(from).toHaveBeenCalledWith("client_exercise_swaps");
  });

  it("throws on empty names", async () => {
    await expect(saveSwap("c", "   ", "Жим")).rejects.toThrow();
    await expect(saveSwap("c", "Присед", "  ")).rejects.toThrow();
  });

  it("deletes by client+key", async () => {
    const from = mockFrom({ data: null, error: null });
    await revertSwap("client-1", "Приседания со штангой");
    expect(from).toHaveBeenCalledWith("client_exercise_swaps");
  });
});

describe("findSwapCandidates", () => {
  it("noMatch when original not in a non-empty library", async () => {
    mockFrom({
      data: [{ id: "x", name: "Жим лёжа", name_key: "жимлежа", aliases: [], muscle_group: "Грудь" }],
      error: null,
    });
    const r = await findSwapCandidates("Неизвестное", null);
    expect(r).toEqual({ candidates: [], noMatch: true, error: false });
  });

  it("noMatch when original has no muscle group", async () => {
    mockFrom({
      data: [
        { id: "orig", name_key: "жимлежа", name: "Жим лёжа", aliases: [], muscle_group: null },
        { id: "x", name: "Жим гантелей", name_key: "жимгантелей", aliases: [], muscle_group: "Грудь" },
      ],
      error: null,
    });
    const r = await findSwapCandidates("Жим лёжа", null);
    expect(r).toEqual({ candidates: [], noMatch: true, error: false });
  });

  it("same muscle group, excludes original, equipment first", async () => {
    mockFrom({
      data: [
        { id: "orig", name: "Присед", name_key: "присед", aliases: [], muscle_group: "Ноги" },
        { id: "a", name: "Выпады", muscle_group: "Ноги", equipment: "Гантели" },
        { id: "b", name: "Жим ногами", muscle_group: "Ноги", equipment: "Тренажёр" },
        { id: "c", name: "Планка", muscle_group: "Кор", equipment: "Коврик" },
      ],
      error: null,
    });
    const r = await findSwapCandidates("Присед", "гантели");
    expect(r.noMatch).toBe(false);
    expect(r.candidates.map((c) => c.id)).toEqual(["a", "b"]);
    expect(r.candidates[0].equipmentMatch).toBe(true);
  });

  it("falls back to related groups when the primary group has no peers", async () => {
    mockFrom({
      data: [
        { id: "orig", name: "Подъём на носки", name_key: "подъемнаноски", aliases: [], muscle_group: "Икры" },
        { id: "legs", name: "Жим ногами", muscle_group: "Ноги", equipment: "Тренажёр" },
        { id: "chest", name: "Жим лёжа", muscle_group: "Грудь", equipment: "Штанга" },
      ],
      error: null,
    });
    const r = await findSwapCandidates("Подъём на носки", null);
    expect(r.noMatch).toBe(false);
    expect(r.candidates.map((c) => c.id)).toEqual(["legs"]);
  });

  it("resolves a multi-word alias", async () => {
    mockFrom({
      data: [
        {
          id: "orig",
          name: "Выпады с гантелями",
          name_key: "выпадысгантелями",
          aliases: ["Шагающие выпады"],
          muscle_group: "Ноги",
        },
        { id: "b", name: "Жим ногами", muscle_group: "Ноги", equipment: "Тренажёр" },
      ],
      error: null,
    });
    const r = await findSwapCandidates("Шагающие выпады", null);
    expect(r.noMatch).toBe(false);
    expect(r.candidates.map((c) => c.id)).toEqual(["b"]);
  });

  it("prefers a canonical name over another row's alias", async () => {
    mockFrom({
      data: [
        {
          id: "alias-owner",
          name: "Становая тяга",
          name_key: "становаятяга",
          aliases: ["Румынская тяга"],
          muscle_group: "Ягодицы",
        },
        {
          id: "canonical",
          name: "Румынская тяга",
          name_key: "румынскаятяга",
          aliases: [],
          muscle_group: "Ягодицы",
        },
        { id: "c", name: "Ягодичный мост", muscle_group: "Ягодицы", equipment: "Штанга" },
      ],
      error: null,
    });
    const r = await findSwapCandidates("Румынская тяга", null);
    expect(r.noMatch).toBe(false);
    const ids = r.candidates.map((c) => c.id);
    expect(ids).toContain("alias-owner");
    expect(ids).toContain("c");
  });

  it("caps candidates at the limit", async () => {
    const data = [
      { id: "orig", name: "Присед", name_key: "присед", aliases: [], muscle_group: "Ноги" },
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `n${i}`,
        name: `Ноги ${i}`,
        muscle_group: "Ноги",
        equipment: null,
      })),
    ];
    mockFrom({ data, error: null });
    const r = await findSwapCandidates("Присед", null, 3);
    expect(r.candidates).toHaveLength(3);
  });

  it("returns error instead of noMatch when the library query fails", async () => {
    const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    fromMock.from.mockReturnValue(chain({ data: null, error: { message: "boom" } } as never));
    const r = await findSwapCandidates("Присед", null);
    expect(r).toEqual({ candidates: [], noMatch: false, error: true });
  });
});
