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
  for (const m of ["select", "eq", "neq", "or", "limit", "delete", "upsert"]) {
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
  it("noMatch when original not in library", async () => {
    mockFrom({ data: [], error: null });
    const r = await findSwapCandidates("Неизвестное", null);
    expect(r).toEqual({ candidates: [], noMatch: true });
  });

  it("same muscle group, excludes original, equipment first", async () => {
    const fromMock = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    fromMock.from
      .mockReturnValueOnce(
        chain({ data: [{ id: "orig", muscle_group: "Ноги" }], error: null }),
      )
      .mockReturnValueOnce(
        chain({
          data: [
            { id: "a", name: "Выпады", muscle_group: "Ноги", equipment: "Гантели" },
            { id: "b", name: "Жим ногами", muscle_group: "Ноги", equipment: "Тренажёр" },
          ],
          error: null,
        }),
      );
    const r = await findSwapCandidates("Присед", "тренажёр гантели");
    expect(r.noMatch).toBe(false);
    expect(r.candidates.map((c) => c.id)).not.toContain("orig");
    expect(r.candidates).toHaveLength(2);
    expect(fromMock.from).toHaveBeenCalledTimes(2);
  });
});
