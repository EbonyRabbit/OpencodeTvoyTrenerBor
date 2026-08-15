import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    telegram: { botToken: "test", webhookSecret: "test" },
    supabase: { url: "http://localhost:54321", serviceRoleKey: "test" },
    coachChatId: 0n,
    paymentBaseUrl: "",
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
  hashLibraryKey,
  buildExerciseInfoButton,
  buildInfoHtml,
  handleExerciseInfoCallback,
  loadExerciseLibraryRows,
  clearExerciseLibraryCache,
  LIBRARY_SELECT,
} from "../exercise-info.js";
import { buildExerciseLibraryMap, type ExerciseLibraryRow } from "../../lib/exercise-library.js";
import type { ParsedExercise } from "../../lib/program-utils.js";
import type { MyContext } from "../../bot.js";

function row(partial: Partial<ExerciseLibraryRow>): ExerciseLibraryRow {
  return {
    id: partial.id ?? "00000000-0000-0000-0000-000000000000",
    name: partial.name ?? "Тест",
    name_key: partial.name_key ?? partial.name ?? "Тест",
    aliases: partial.aliases ?? [],
    description_ru: null,
    description_en: null,
    technique_ru: partial.technique_ru ?? "Техника 1",
    technique_en: partial.technique_en ?? null,
    features_ru: partial.features_ru ?? [],
    features_en: partial.features_en ?? [],
    video_url: partial.video_url ?? null,
  };
}

function makeCtx(overrides: Partial<MyContext> = {}): MyContext {
  const reply = vi.fn().mockResolvedValue(undefined);
  return {
    from: { id: 123, username: "client" },
    language: "ru",
    reply,
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    ...overrides,
    reply,
  } as unknown as MyContext;
}

describe("hashLibraryKey", () => {
  it("returns the first 8 hex chars of the sha1", async () => {
    const hash = await hashLibraryKey("жимлежа");
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    expect(await hashLibraryKey("жимлежа")).toBe(hash);
  });

  it("differs across keys", async () => {
    const a = await hashLibraryKey("жимлежа");
    const b = await hashLibraryKey("тягагантели");
    expect(a).not.toBe(b);
  });
});

describe("buildExerciseInfoButton", () => {
  const map = buildExerciseLibraryMap([
    row({ id: "a", name: "Жим лёжа", name_key: "Жим лёжа" }),
    row({ id: "b", name: "Тяга гантели", name_key: "Тяга гантели" }),
  ]);

  it("returns null when the exercise is not in the library", async () => {
    expect(await buildExerciseInfoButton({ name: "Выпады", sets: 3, reps: "10" }, map, "ru")).toBeNull();
  });

  it("builds a single-exercise button for a matched exercise", async () => {
    const button = await buildExerciseInfoButton({ name: "Жим лёжа", sets: 3, reps: "10" }, map, "ru");
    expect(button).not.toBeNull();
    expect(button!.callback_data).toBe(`exercise_info:e:${await hashLibraryKey("жимлежа")}`);
    expect(button!.text).toContain("Техника и видео");
  });

  it("builds a composite button from matched children only", async () => {
    const composite: ParsedExercise = {
      name: "Суперсет",
      type: "superset",
      children: [
        { name: "Жим лёжа", sets: 3, reps: "10" },
        { name: "Выпады", sets: 3, reps: "10" },
      ],
    };
    const button = await buildExerciseInfoButton(composite, map, "ru");
    expect(button!.callback_data).toBe(
      `exercise_info:s:${await hashLibraryKey("жимлежа")}`,
    );
  });

  it("returns null for a composite with no matched children", async () => {
    const composite: ParsedExercise = {
      name: "Круг",
      type: "circuit",
      children: [{ name: "Выпады", sets: 1, reps: "10" }],
    };
    expect(await buildExerciseInfoButton(composite, map, "ru")).toBeNull();
  });
});

describe("buildInfoHtml", () => {
  const entry = buildExerciseLibraryMap([row({ id: "a", name: "Жим лёжа" })]).get("жимлежа")!;

  it("escapes exercise names in html", () => {
    const html = buildInfoHtml([{ name: "Жим <x>", entry }], "ru");
    expect(html).toContain("&lt;x&gt;");
    expect(html).not.toContain("<x>");
  });

  it("renders a missing entry as not_found", () => {
    const html = buildInfoHtml([{ name: "Нет в базе", entry: null }], "ru");
    expect(html).toContain("не найдено в библиотеке");
  });

  it("renders the video link when present", () => {
    const withVideo = buildExerciseLibraryMap([
      row({ id: "a", name: "Жим лёжа", video_url: "https://youtu.be/abc" }),
    ]).get("жимлежа")!;
    const html = buildInfoHtml([{ name: "Жим лёжа", entry: withVideo }], "ru");
    expect(html).toContain('href="https://youtu.be/abc"');
  });
});

describe("handleExerciseInfoCallback", () => {
  function mockLibraryQuery(rows: ExerciseLibraryRow[]) {
    const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    const chain = {
      select: vi.fn((cols: string) => {
        expect(cols).toBe(LIBRARY_SELECT);
        return chain;
      }),
      then: (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(onFulfilled),
    };
    fake.from.mockImplementation((table: string) => {
      if (table === "exercises") return chain;
      throw new Error(`Unexpected table: ${table}`);
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    clearExerciseLibraryCache();
  });

  it("replies not_found for an unknown kind", async () => {
    const ctx = makeCtx();
    await handleExerciseInfoCallback(ctx, "x:y");
    expect(ctx.reply).toHaveBeenCalledWith("Упражнение не найдено в библиотеке");
  });

  it("replies with technique html for a matched hash", async () => {
    mockLibraryQuery([row({ id: "a", name: "Жим лёжа" })]);
    const ctx = makeCtx();
    const hash = await hashLibraryKey("жимлежа");
    await handleExerciseInfoCallback(ctx, `e:${hash}`);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("<b>Жим лёжа</b>"),
      { parse_mode: "HTML" },
    );
  });

  it("replies not_found when no hash matches", async () => {
    mockLibraryQuery([row({ id: "a", name: "Жим лёжа" })]);
    const ctx = makeCtx();
    await handleExerciseInfoCallback(ctx, "e:ffffffff");
    expect(ctx.reply).toHaveBeenCalledWith("Упражнение не найдено в библиотеке");
  });

  it("replies with a combined message for multiple matched children", async () => {
    mockLibraryQuery([
      row({ id: "a", name: "Жим лёжа", technique_ru: "Техника А" }),
      row({ id: "b", name: "Тяга гантели", technique_ru: "Техника Б" }),
    ]);
    const ctx = makeCtx();
    const hashes = [
      await hashLibraryKey("жимлежа"),
      await hashLibraryKey("тягагантели"),
    ];
    await handleExerciseInfoCallback(ctx, `s:${hashes.join(",")}`);
    const replyArg = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(replyArg).toContain("1. Жим лёжа");
    expect(replyArg).toContain("2. Тяга гантели");
  });

  it("dedupes hashes resolving to the same library entry", async () => {
    mockLibraryQuery([
      row({
        id: "a",
        name: "Жим лёжа",
        name_key: "Жим лёжа",
        aliases: ["Жим штанги лежа"],
      }),
    ]);
    const ctx = makeCtx();
    const hashes = [
      await hashLibraryKey("жимлежа"),
      await hashLibraryKey("жимштангилежа"),
    ];
    await handleExerciseInfoCallback(ctx, `s:${hashes.join(",")}`);
    const replyArg = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const occurrences = replyArg.split("<b>Жим лёжа</b>").length - 1;
    expect(occurrences).toBe(1);
    expect(replyArg).not.toContain("2. ");
  });

  it("caches loaded rows within the ttl window", async () => {
    mockLibraryQuery([row({ id: "a", name: "Жим лёжа" })]);
    const rows = await loadExerciseLibraryRows();
    const again = await loadExerciseLibraryRows();
    expect(rows).toHaveLength(1);
    expect(again).toBe(rows);
    const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    expect(fake.from).toHaveBeenCalledTimes(1);
  });
});

describe("loadExerciseLibraryRows error handling", () => {
  function okChain(rows: ExerciseLibraryRow[]) {
    const self = {
      select: () => self,
      then: (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(onFulfilled),
    };
    return self;
  }

  function queryWith(chain: { select(): unknown; then?: unknown }) {
    const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    fake.from.mockImplementation((table: string) => {
      if (table === "exercises") return chain;
      throw new Error(`Unexpected table: ${table}`);
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    clearExerciseLibraryCache();
  });

  it("returns stale rows when the query reports an error", async () => {
    vi.useFakeTimers();
    try {
      const errChain = {
        select: () => errChain,
        then: (onFulfilled: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: { message: "boom" } }).then(onFulfilled),
      };
      queryWith(okChain([row({ id: "a", name: "Жим лёжа" })]));
      await loadExerciseLibraryRows();
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      queryWith(errChain as never);
      const rows = await loadExerciseLibraryRows();
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("Жим лёжа");
      const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
      expect(fake.from).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns stale rows when the fetch rejects", async () => {
    vi.useFakeTimers();
    try {
      const rejectChain = {
        select: () => rejectChain,
        then: () => Promise.reject(new Error("network down")),
      };
      queryWith(okChain([row({ id: "a", name: "Жим лёжа" })]));
      await loadExerciseLibraryRows();
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      queryWith(rejectChain as never);
      const rows = await loadExerciseLibraryRows();
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("Жим лёжа");
      const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
      expect(fake.from).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns empty rows on the first fetch when the query errors", async () => {
    const errChain = {
      select: () => errChain,
      then: (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: { message: "boom" } }).then(onFulfilled),
    };
    queryWith(errChain as never);
    expect(await loadExerciseLibraryRows()).toEqual([]);
  });

  it("does not overwrite the cache with failed loads", async () => {
    vi.useFakeTimers();
    try {
      const errChain = {
        select: () => errChain,
        then: (onFulfilled: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: { message: "boom" } }).then(onFulfilled),
      };
      queryWith(okChain([row({ id: "a", name: "Жим лёжа" })]));
      await loadExerciseLibraryRows();
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      queryWith(errChain as never);
      const rows = await loadExerciseLibraryRows();
      const again = await loadExerciseLibraryRows();
      expect(rows).toHaveLength(1);
      expect(again).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("dedupes concurrent fetches into a single query", async () => {
    queryWith(okChain([row({ id: "a", name: "Жим лёжа" })]));
    const [a, b] = await Promise.all([
      loadExerciseLibraryRows(),
      loadExerciseLibraryRows(),
    ]);
    expect(a).toEqual(b);
    const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
    expect(fake.from).toHaveBeenCalledTimes(1);
  });

  it("refetches after the ttl window expires", async () => {
    vi.useFakeTimers();
    try {
      queryWith(okChain([row({ id: "a", name: "Жим лёжа" })]));
      await loadExerciseLibraryRows();
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      await loadExerciseLibraryRows();
      const fake = supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> };
      expect(fake.from).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("warns on sha1 prefix collisions between library entries", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const digest = vi
      .spyOn(crypto.subtle, "digest")
      .mockResolvedValue(
        new Uint8Array([0x61, 0x61, 0x61, 0x61, 0x61, 0x61, 0x61, 0x61]).buffer as ArrayBuffer,
      );
    try {
      queryWith(okChain([
        row({ id: "a", name: "Жим лёжа" }),
        row({ id: "b", name: "Тяга гантели" }),
      ]));
      const ctx = makeCtx();
      await handleExerciseInfoCallback(ctx, "e:61616161");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("collision"));
    } finally {
      digest.mockRestore();
      warn.mockRestore();
    }
  });
});