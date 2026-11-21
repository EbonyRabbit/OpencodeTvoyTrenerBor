import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MyContext } from "../../bot.js";
import type { Client } from "../../lib/clients.js";

vi.mock("../../lib/supabase-admin.js", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("../../lib/exercise-library-cache.js", () => ({
  loadExerciseLibraryRows: vi.fn(),
}));

vi.mock("../guards.js", () => ({
  guardActiveClient: vi.fn(),
}));

import { loadExerciseLibraryRows } from "../../lib/exercise-library-cache.js";
import { supabaseAdmin } from "../../lib/supabase-admin.js";
import { guardActiveClient } from "../guards.js";
import { progressHandler } from "../progress.js";

const CLIENT = {
  id: "client-1",
  language: "ru",
  timezone: "UTC",
} as Client;

const ROWS = [
  {
    exercise: "Присед",
    date: "2026-11-10",
    sets: 3,
    reps: "8",
    weight: 60,
    rounds: null,
    duration_sec: null,
    distance_km: null,
    pace: null,
  },
  {
    exercise: "Присед",
    date: "2026-11-03",
    sets: 3,
    reps: "6",
    weight: 55,
    rounds: null,
    duration_sec: null,
    distance_km: null,
    pace: null,
  },
  {
    exercise: "Отжимания",
    date: "2026-11-09",
    sets: 3,
    reps: "15",
    weight: 0,
    rounds: null,
    duration_sec: null,
    distance_km: null,
    pace: null,
  },
  {
    exercise: "[skip] Отдых",
    date: "2026-11-08",
    sets: null,
    reps: null,
    weight: null,
    rounds: null,
    duration_sec: null,
    distance_km: null,
    pace: null,
  },
];

let currentChain: ReturnType<typeof logsChain> | null = null;

function logsChain(
  data: typeof ROWS,
  error: { message: string } | null = null,
) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    lte: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(async () => ({ data, error })),
  };
  return chain;
}

function makeCtx(): MyContext {
  return {
    from: { id: 123456789, username: "client" },
    language: "ru",
    reply: vi.fn().mockResolvedValue({}),
  } as unknown as MyContext;
}

function lastText(ctx: MyContext): string {
  const calls = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls;
  return String(calls.at(-1)?.[0] ?? "");
}

function replyOptions(ctx: MyContext): unknown {
  const calls = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls;
  return calls.at(-1)?.[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  currentChain = logsChain(ROWS);
  (guardActiveClient as ReturnType<typeof vi.fn>).mockResolvedValue({ client: CLIENT });
  (loadExerciseLibraryRows as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(() => currentChain);
});

describe("progressHandler", () => {
  it("shows exercise progress instead of an empty title", async () => {
    const ctx = makeCtx();

    await progressHandler(ctx);

    const text = lastText(ctx);
    expect(text).toContain("Прогресс:");
    expect(text).toContain("Присед");
    expect(text).toContain("Отжимания");
    expect(text).not.toContain("[skip]");
    expect(replyOptions(ctx)).toEqual({ parse_mode: "HTML" });
  });

  it("applies the workout log query contract", async () => {
    await progressHandler(makeCtx());

    expect(currentChain?.eq).toHaveBeenCalledWith("client_id", "client-1");
    expect(currentChain?.lte).toHaveBeenCalledWith(
      "date",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
    expect(currentChain?.order).toHaveBeenCalledWith("date", { ascending: false });
    expect(currentChain?.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(currentChain?.limit).toHaveBeenCalledWith(1000);
  });

  it("uses the client timezone for the today cutoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T22:00:00.000Z"));
    (guardActiveClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      client: { ...CLIENT, timezone: "Europe/Moscow" },
    });

    try {
      await progressHandler(makeCtx());
      expect(currentChain?.lte).toHaveBeenCalledWith("date", "2026-11-20");
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps the reply at five exercises", async () => {
    const manyRows = Array.from({ length: 7 }, (_, index) => ({
      ...ROWS[0],
      exercise: `Упражнение ${index}`,
      date: `2026-11-${String(10 - index).padStart(2, "0")}`,
    }));
    currentChain = logsChain(manyRows);
    const ctx = makeCtx();

    await progressHandler(ctx);

    const text = lastText(ctx);
    for (let index = 0; index < 5; index++) {
      expect(text).toContain(`Упражнение ${index}`);
    }
    expect(text).not.toContain("Упражнение 5");
    expect(text).not.toContain("Упражнение 6");
  });

  it("caps each exercise at five log entries", async () => {
    const manyRows = Array.from({ length: 8 }, (_, index) => ({
      ...ROWS[0],
      date: `2026-11-${String(10 - index).padStart(2, "0")}`,
    }));
    currentChain = logsChain(manyRows);
    const ctx = makeCtx();

    await progressHandler(ctx);

    const text = lastText(ctx);
    expect(text).toContain("10.11");
    expect(text).toContain("06.11");
    expect(text).not.toContain("05.11");
  });

  it("escapes exercise names before sending HTML", async () => {
    currentChain = logsChain([{ ...ROWS[0], exercise: "<b>Присед</b>" }]);
    const ctx = makeCtx();

    await progressHandler(ctx);

    const text = lastText(ctx);
    expect(text).toContain("&lt;b&gt;Присед&lt;/b&gt;");
    expect(text).not.toContain("<b>Присед</b>");
  });

  it("explains when there are no workout logs", async () => {
    currentChain = logsChain([]);
    const ctx = makeCtx();

    await progressHandler(ctx);

    expect(lastText(ctx)).toContain("/today");
    expect(replyOptions(ctx)).toBeUndefined();
  });

  it("does not query logs when the guard blocks access", async () => {
    (guardActiveClient as ReturnType<typeof vi.fn>).mockResolvedValue("нет доступа");
    const ctx = makeCtx();

    await progressHandler(ctx);

    expect(lastText(ctx)).toBe("нет доступа");
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("fails closed when the log query fails", async () => {
    currentChain = logsChain([], { message: "db down" });
    const ctx = makeCtx();

    await progressHandler(ctx);

    expect(lastText(ctx)).not.toContain("Прогресс:");
    expect(lastText(ctx)).toContain("Сервис временно недоступен");
  });
});
