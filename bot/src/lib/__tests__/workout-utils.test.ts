import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock("../../config.js", () => ({
  config: {
    telegram: { botToken: "test", webhookSecret: "test" },
    supabase: { url: "http://localhost:54321", serviceRoleKey: "test" },
    coachChatId: 0n,
    paymentBaseUrl: "",
    nodeEnv: "test",
    port: 3001,
    webhookPath: "/webhook",
  },
}));

vi.mock("../supabase-admin.js", () => ({
  supabaseAdmin: { from: mocks.mockFrom },
}));

import { truncateMessage, formatExercise, formatSingleExercise, formatWorkoutMessage, getPreviousWorkoutLogs, isTodayWorkoutCompleted, getIsoWeekday, dayOrderForDate, matchDayByOrder, isPseudoName, getTodayISODay, getTodayDayOfMonth, parseTimeRounded, plannedDateForDay, escapeHtml } from "../workout-utils.js";

function mockLogsQuery(rows: Array<Record<string, unknown>>, error: { message: string } | null = null) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    lt: vi.fn(() => builder),
    or: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => ({ data: rows, error })),
  };
  mocks.mockFrom.mockReturnValue(builder);
  return builder;
}

describe("truncateMessage", () => {
  const suffix = "\n\n⚠️ …";

  it("returns message unchanged if within limit", () => {
    const msg = "Short message";
    expect(truncateMessage(msg, suffix)).toBe(msg);
  });

  it("truncates long message at newline boundary", () => {
    const msg = "Line 1\nLine 2\n" + "x".repeat(5000);
    const result = truncateMessage(msg, suffix);
    expect(result.length).toBeLessThanOrEqual(4096);
    expect(result).toContain(suffix);
    expect(result).not.toContain("xxxx");
  });

  it("truncates at last newline before limit", () => {
    const msg = "A".repeat(4000) + "\n" + "B".repeat(200);
    const result = truncateMessage(msg, suffix);
    expect(result).not.toContain("\nB");
  });

  it("closes unclosed italic tags after truncation", () => {
    const longLine = "<i>".repeat(200) + "x".repeat(5000);
    const result = truncateMessage(longLine, suffix, { html: true });
    const opens = (result.match(/<i>/g) ?? []).length;
    const closes = (result.match(/<\/i>/g) ?? []).length;
    expect(opens).toBe(closes);
    expect(result).toContain("</i>");
    expect(result.length).toBeLessThanOrEqual(4096);
  });

  it("closes bold tags left open at the truncation point", () => {
    const msg = "<b>Присед\n" + "y".repeat(5000);
    const result = truncateMessage(msg, suffix, { html: true });
    const opens = (result.match(/<b>/g) ?? []).length;
    const closes = (result.match(/<\/b>/g) ?? []).length;
    expect(opens).toBe(closes);
    expect(opens).toBeGreaterThan(0);
    expect(result).toContain("</b>");
  });

  it("closes nested unclosed tags in the right order", () => {
    const msg = "<b><i>Детали\n" + "z".repeat(5000);
    const result = truncateMessage(msg, suffix, { html: true });
    const lastCloseB = result.lastIndexOf("</b>");
    const lastCloseI = result.lastIndexOf("</i>");
    expect(lastCloseI).toBeGreaterThan(-1);
    expect(lastCloseB).toBeGreaterThan(lastCloseI);
  });

  it("strips a dangling partial opening tag at the cut point", () => {
    const msg = "x".repeat(4086) + "<b\n" + "y".repeat(500);
    const result = truncateMessage(msg, suffix, { html: true });
    expect(result).not.toContain("<b\n");
    expect(result).not.toMatch(/<[a-zA-Z]*$/);
    expect(result.length).toBeLessThanOrEqual(4096);
  });

  it("strips a partial HTML entity cut at the truncation boundary", () => {
    const msg = "a".repeat(4085) + "&amp;" + "z".repeat(5000);
    const result = truncateMessage(msg, suffix, { html: true });
    expect(result).not.toContain("&");
    expect(result).toBe("a".repeat(4085) + suffix);
    expect(result.length).toBeLessThanOrEqual(4096);
  });

  it("leaves plain text untouched without the html option", () => {
    const msg = "<i>x\n" + "y".repeat(5000);
    const result = truncateMessage(msg, suffix);
    expect(result).not.toContain("</i>");
  });
});

describe("escapeHtml", () => {
  it("escapes ampersands, angle brackets and quotes", () => {
    expect(escapeHtml(`A & B <x> "q"`)).toBe("A &amp; B &lt;x&gt; &quot;q&quot;");
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("Присед 3×8")).toBe("Присед 3×8");
  });
});

describe("formatExercise", () => {
  function withLast(ex: Record<string, unknown>, log: Record<string, unknown> | null) {
    const map = new Map();
    if (log) map.set(String(ex.name).trim().toLowerCase(), log);
    return formatExercise(1, ex as never, "ru", map as ReadonlyMap<string, never>);
  }

  it("includes last time line when previous log present", () => {
    const ex = { name: "Присед", sets: "4", reps: "8", weight: "60" };
    const result = withLast(ex, { weight: 60, sets: 4, reps: "8" });
    expect(result).toContain("Прошлый раз");
    expect(result).toContain("60");
    expect(result).toContain("4×8");
  });

  it("omits last time line when no previous log", () => {
    const ex = { name: "Присед", sets: "4", reps: "8", weight: "60" };
    const result = formatExercise(1, ex as never, "ru", new Map());
    expect(result).not.toContain("Прошлый раз");
  });

  it("formats weight-only previous log", () => {
    const ex = { name: "Жим", sets: "3", reps: "10", weight: "40" };
    const result = withLast(ex, { weight: 40, sets: null, reps: null });
    expect(result).toContain("40 кг");
  });

  it("formats per-set reps list without sets multiplier", () => {
    const ex = { name: "Жим", sets: "3", reps: "10/10/10", weight: "40" };
    const result = withLast(ex, { weight: 40, sets: 3, reps: "10/10/10" });
    const lastLine = result.split("\n").find((l) => l.includes("Прошлый раз"));
    expect(lastLine).toContain("10/10/10");
    expect(lastLine).not.toContain("3×");
  });

  it("formats varying per-set reps list", () => {
    const ex = { name: "Тяга", sets: "3", reps: "8/7/6", weight: "60" };
    const result = withLast(ex, { weight: 60, sets: 3, reps: "8/7/6" });
    expect(result).toContain("8/7/6");
  });

  it("still formats ranges with sets multiplier", () => {
    const ex = { name: "Присед", sets: "3", reps: "8-10", weight: "60" };
    const result = withLast(ex, { weight: 60, sets: 3, reps: "8-10" });
    const lastLine = result.split("\n").find((l) => l.includes("Прошлый раз"));
    expect(lastLine).toContain("3×8-10");
  });

  it("shows bodyweight instead of 0 kg", () => {
    const ex = { name: "Отжимания", sets: "3", reps: "15", weight: "0" };
    const result = withLast(ex, { weight: 0, sets: 3, reps: "15" });
    const lastLine = result.split("\n").find((l) => l.includes("Прошлый раз"));
    expect(lastLine).toContain("вес тела");
    expect(lastLine).not.toContain("0 кг");
  });

  it("renders superset with children letters and planned details", () => {
    const ex = {
      name: "Грудь+спина",
      type: "superset",
      children: [
        { name: "Жим лёжа", sets: "3", reps: "8", weight: "60" },
        { name: "Тяга в наклоне", sets: "3", reps: "10", weight: "40" },
      ],
    };
    const result = formatExercise(1, ex as never, "ru", new Map());
    expect(result).toContain("суперсет");
    expect(result).toContain("A1. Жим лёжа");
    expect(result).toContain("A2. Тяга в наклоне");
    expect(result).toContain("3×8");
  });

  it("renders superset with per-child previous logs", () => {
    const map = new Map<string, { weight: number; sets: number; reps: string }>();
    map.set("жим лёжа", { weight: 60, sets: 3, reps: "8" });
    const ex = {
      name: "Грудь+спина",
      type: "superset",
      children: [
        { name: "Жим лёжа", sets: "3", reps: "8", weight: "60" },
        { name: "Тяга в наклоне", sets: "3", reps: "10", weight: "40" },
      ],
    };
    const result = formatExercise(1, ex as never, "ru", map);
    const lastLine = result.split("\n").find((l) => l.includes("Прошлый раз"));
    expect(lastLine).toContain("60 кг");
  });

  it("hides child rest inside superset but keeps parent rest", () => {
    const ex = {
      name: "Грудь+спина",
      type: "superset",
      rest: "120",
      children: [
        { name: "Жим", sets: "3", reps: "8", rest: "30" },
        { name: "Тяга", sets: "3", reps: "10", rest: "45" },
      ],
    };
    const result = formatExercise(1, ex as never, "ru", new Map());
    const restLines = result.split("\n").filter((l) => l.includes("Отдых"));
    expect(restLines).toHaveLength(1);
    expect(restLines[0]).toContain("120");
    expect(restLines[0]).not.toContain("30");
    expect(restLines[0]).not.toContain("45");
  });

  it("hides child rest inside circuit but keeps parent rest", () => {
    const ex = {
      name: "Круг",
      type: "circuit",
      rounds: "3",
      rest: "90",
      children: [{ name: "Берпи", sets: "3", reps: "15", rest: "30" }],
    };
    const result = formatExercise(1, ex as never, "ru", new Map());
    const restLines = result.split("\n").filter((l) => l.includes("Отдых"));
    expect(restLines).toHaveLength(1);
    expect(restLines[0]).toContain("90");
    expect(restLines[0]).not.toContain("30");
  });

  it("renders cardio with planned metrics", () => {
    const ex = {
      name: "Бег",
      type: "cardio",
      distance: "5 км",
      duration: "30 мин",
      pace: "5:30/км",
      heart_rate: "140-160",
    };
    const result = formatExercise(1, ex as never, "ru", new Map());
    expect(result).toContain("Бег");
    expect(result).toContain("Дистанция: 5 км");
    expect(result).toContain("Пульс: 140-160");
  });

  it("renders circuit with children and rounds goal", () => {
    const ex = {
      name: "Круг на всё тело",
      type: "circuit",
      rounds: "МАКС",
      duration: "20 мин",
      children: [
        { name: "Берпи", sets: "3", reps: "15" },
        { name: "Присед", sets: "3", reps: "10", weight: "20" },
      ],
    };
    const result = formatExercise(1, ex as never, "ru", new Map());
    expect(result).toContain("(круг)");
    expect(result).toContain("A1. Берпи");
    expect(result).toContain("3×15");
    expect(result).toContain("A2. Присед");
    expect(result).toContain("20 кг");
    expect(result).toContain("Цель: МАКС раундов");
    expect(result).not.toContain("за 20 мин");
    expect(result).not.toContain("20 мин");
  });

  it("renders circuit children with bodyweight and sets-only fallback", () => {
    const ex = {
      name: "Круг",
      type: "circuit",
      rounds: "3",
      children: [
        { name: "Отжимания", sets: "3", reps: "15", weight: "0" },
        { name: "Планка", sets: "4" },
      ],
    };
    const result = formatExercise(1, ex as never, "ru", new Map());
    expect(result).toContain("A1. Отжимания");
    expect(result).toContain("3×15 · вес тела");
    expect(result).toContain("A2. Планка");
    expect(result).toContain("4 подх.");
    expect(result).not.toContain("0 кг");
  });

  it("shows previous rounds for the circuit parent in day plan", () => {
    const ex = {
      name: "Круг на всё тело",
      type: "circuit",
      rounds: "4",
      children: [{ name: "Берпи", sets: "3", reps: "15" }],
    };
    const map = new Map<string, { rounds: number; duration_sec: number; sets: number | null; reps: string | null; weight: number | null }>();
    map.set("круг на всё тело", { rounds: 3, duration_sec: 900, sets: null, reps: null, weight: null });
    const result = formatExercise(1, ex as never, "ru", map);
    expect(result).toContain("Прошлый раз");
    expect(result).toContain("3 раунд");
    expect(result).not.toContain("мин");
  });

  it("pluralizes the circuit goal rounds", () => {
    const base = { name: "Круг", type: "circuit", children: [] };
    expect(formatExercise(1, { ...base, rounds: "1" } as never, "ru", new Map())).toContain("Цель: 1 раунд");
    expect(formatExercise(1, { ...base, rounds: "2" } as never, "ru", new Map())).toContain("Цель: 2 раунда");
    expect(formatExercise(1, { ...base, rounds: "5" } as never, "ru", new Map())).toContain("Цель: 5 раундов");
    expect(formatExercise(1, { ...base, rounds: "МАКС" } as never, "ru", new Map())).toContain("Цель: МАКС раундов");
  });

  it("escapes HTML characters in non-numeric rounds goal text", () => {
    const ex = { name: "Круг", type: "circuit", rounds: "До & отказа", children: [] };
    const result = formatExercise(1, ex as never, "ru", new Map());
    expect(result).toContain("До &amp; отказа раундов");
    expect(result).not.toContain("До & отказа");
  });

  it("wraps the exercise name in a bold tag", () => {
    const ex = { name: "Присед", sets: "4", reps: "8", weight: "60" };
    const result = formatExercise(1, ex as never, "ru", new Map());
    expect(result).toContain("<b>1. Присед</b>");
  });

  it("renders the plan on one line joined by dots", () => {
    const ex = { name: "Присед", sets: "4", reps: "8", weight: "60", rpe: "8" };
    const result = formatExercise(1, ex as never, "ru", new Map());
    const planLine = result.split("\n").find((l) => l.includes("4×8"));
    expect(planLine).toBe("4×8 · 60 кг · RPE 8");
  });

  it("wraps the last-time line in an italic tag", () => {
    const ex = { name: "Присед", sets: "4", reps: "8", weight: "60" };
    const result = withLast(ex, { weight: 60, sets: 4, reps: "8" });
    const lastLine = result.split("\n").find((l) => l.includes("Прошлый раз"));
    expect(lastLine).toContain("<i>");
    expect(lastLine).toContain("</i>");
    expect(lastLine).toContain("60 кг · 4×8");
  });

  it("escapes HTML characters in exercise name", () => {
    const ex = { name: "Жим <sup>тест</sup>", sets: "3", reps: "10" };
    const result = formatExercise(1, ex as never, "ru", new Map());
    expect(result).toContain("<b>1. Жим &lt;sup&gt;тест&lt;/sup&gt;</b>");
    expect(result).not.toContain("<sup>");
  });

  it("escapes HTML characters in rest and notes", () => {
    const ex = { name: "Присед", sets: "3", reps: "8", rest: "90 <сек>", notes: "До & отказа" };
    const result = formatExercise(1, ex as never, "ru", new Map());
    expect(result).toContain("90 &lt;сек&gt;");
    expect(result).toContain("До &amp; отказа");
    expect(result).not.toContain("90 <сек>");
  });

  it("escapes HTML characters in superset children", () => {
    const ex = {
      name: "Грудь+спина",
      type: "superset",
      children: [{ name: "Жим <узкий>", sets: "3", reps: "8" }],
    };
    const result = formatExercise(1, ex as never, "ru", new Map());
    expect(result).toContain("A1. Жим &lt;узкий&gt;");
  });

  it("escapes HTML characters in superset and circuit names", () => {
    const superset = formatExercise(1, {
      name: "Грудь <и> спина",
      type: "superset",
      children: [{ name: "Жим", sets: "3", reps: "8" }],
    } as never, "ru", new Map());
    expect(superset).toContain("Грудь &lt;и&gt; спина (суперсет)");

    const circuit = formatExercise(1, {
      name: "Круг <и> всё",
      type: "circuit",
      rounds: "3",
      children: [{ name: "Берпи", sets: "3", reps: "15" }],
    } as never, "ru", new Map());
    expect(circuit).toContain("Круг &lt;и&gt; всё (круг)");
  });

  it("escapes HTML characters in previous-log reps and pace", () => {
    const ex = { name: "Присед", sets: "3", reps: "8" };
    const result = withLast(ex, {
      weight: 60,
      sets: 3,
      reps: "<не вышло>",
      distance_km: null,
      duration_sec: null,
      rounds: null,
      pace: null,
      heart_rate: null,
    });
    const lastLine = result.split("\n").find((l) => l.includes("Прошлый раз"));
    expect(lastLine).toContain("&lt;не вышло&gt;");
    expect(lastLine).not.toContain("<не вышло>");
  });
});

describe("formatSingleExercise", () => {
  it("hides child rest in single superset view but keeps parent rest", () => {
    const exercise = {
      name: "Грудь+спина",
      type: "superset",
      rest: "120",
      children: [
        { name: "Жим", sets: "3", reps: "8", rest: "30" },
        { name: "Тяга", sets: "3", reps: "10", rest: "45" },
      ],
    };
    const result = formatSingleExercise(0, 1, exercise as never, "ru", new Map());
    const restLines = result.split("\n").filter((l) => l.includes("Отдых"));
    expect(restLines).toHaveLength(1);
    expect(restLines[0]).toContain("120");
    expect(restLines[0]).not.toContain("30");
    expect(restLines[0]).not.toContain("45");
  });

  it("uses batched child logs and localizes cardio metrics", () => {
    const exercise = {
      name: "Mixed superset",
      type: "superset",
      sets: "3",
      children: [
        { name: "Bench press", reps: "8" },
        { name: "Run", type: "cardio", distance: "1 km" },
      ],
    };
    const lastLogs = new Map([
      ["run", {
        weight: null,
        sets: null,
        reps: null,
        rounds: null,
        duration_sec: 300,
        distance_km: 1,
        pace: "5:00",
        heart_rate: 145,
      }],
    ]);

    const result = formatSingleExercise(0, 1, exercise as never, "en", lastLogs);

    expect(result).toContain("A2. Run");
    expect(result).toContain("1 km");
    expect(result).toContain("pace 5:00");
    expect(result).toContain("heart rate 145");
    expect(result).not.toContain("пульс");
  });

  it("renders circuit children with planned detail and rounds goal", () => {
    const exercise = {
      name: "Круг на всё тело",
      type: "circuit",
      rounds: "4",
      children: [
        { name: "Берпи", sets: "3", reps: "15", weight: "20" },
        { name: "Джампинг Джек", sets: "3", reps: "20", weight: "0" },
      ],
    };
    const result = formatSingleExercise(0, 1, exercise as never, "ru", new Map(), "A");
    expect(result).toContain("(круг)");
    expect(result).toContain("Круг на всё тело");
    expect(result).toContain("A1. Берпи");
    expect(result).toContain("3×15 · 20 кг");
    expect(result).toContain("A2. Джампинг Джек");
    expect(result).toContain("3×20 · вес тела");
    expect(result).toContain("Цель: 4 раунда");
    expect(result).not.toContain("мин");
  });

  it("escapes HTML characters in name, block and rest", () => {
    const exercise = {
      name: "Жим <узким>",
      block: "Грудь & спина",
      rest: "90 <сек>",
      sets: "3",
      reps: "8",
    };
    const result = formatSingleExercise(0, 1, exercise as never, "ru", new Map());
    expect(result).toContain("&lt;узким&gt;");
    expect(result).toContain("Грудь &amp; спина");
    expect(result).toContain("90 &lt;сек&gt;");
    expect(result).not.toContain("<узким>");
    expect(result).not.toContain("<сек>");
  });

  it("escapes non-numeric rounds goal text in single view", () => {
    const exercise = { name: "Круг", type: "circuit", rounds: "До & отказа", children: [] };
    const result = formatSingleExercise(0, 1, exercise as never, "ru", new Map());
    expect(result).toContain("До &amp; отказа раундов");
    expect(result).not.toContain("До & отказа");
  });
});

describe("formatWorkoutMessage", () => {
  it("escapes HTML characters in day name and goal", async () => {
    mockLogsQuery([]);
    const workout = {
      week_number: 3,
      is_deload: false,
      day_name: "Понедельник <тест>",
      goal: "Сила & объем",
      exercises: [{ name: "Присед", sets: "3", reps: "8" }],
    };
    const client = { id: "client-msg-1", timezone: "Europe/Moscow" } as Parameters<typeof formatWorkoutMessage>[2];
    const result = await formatWorkoutMessage(workout as never, "ru", client);
    expect(result).toContain("Понедельник &lt;тест&gt;");
    expect(result).toContain("Сила &amp; объем");
    expect(result).not.toContain("<тест>");
    expect(result).not.toContain("& объем");
  });
});

describe("formatPreviousLog duration hiding", () => {
  it("hides previous duration for circuit logs with rounds", () => {
    const exercise = {
      name: "Круг на всё тело",
      type: "circuit",
      rounds: "4",
      children: [{ name: "Берпи", sets: "3", reps: "15" }],
    };
    const lastLogs = new Map([
      ["круг на всё тело", { rounds: 3, duration_sec: 900, sets: null, reps: null, weight: null, distance_km: null, pace: null, heart_rate: null }],
    ]);
    const result = formatSingleExercise(0, 1, exercise as never, "ru", lastLogs, "A");
    expect(result).toContain("Прошлый раз");
    expect(result).toContain("3 раунд");
    expect(result).not.toContain("мин");
    expect(result).not.toContain("15 мин");
  });

  it("keeps duration for cardio logs without rounds", () => {
    const exercise = { name: "Бег", type: "cardio", duration: "30 мин" };
    const lastLogs = new Map([
      ["бег", { rounds: null, duration_sec: 1500, sets: null, reps: null, weight: null, distance_km: 5, pace: "5:00", heart_rate: 145 }],
    ]);
    const result = formatSingleExercise(0, 1, exercise as never, "ru", lastLogs);
    expect(result).toContain("Прошлый раз");
    expect(result).toContain("25 мин");
  });
});

describe("getPreviousWorkoutLogs", () => {
  const client = { id: "client-1", timezone: "Europe/Moscow" } as Parameters<typeof getPreviousWorkoutLogs>[0];

  it("returns empty map when no exercises requested", async () => {
    const builder = mockLogsQuery([]);
    const result = await getPreviousWorkoutLogs(client, []);
    expect(result.size).toBe(0);
    expect(builder.limit).not.toHaveBeenCalled();
  });

  it("matches exercises case-insensitively and takes the latest row", async () => {
    mockLogsQuery([
      { exercise: "жим штанги лёжа", date: "2026-07-27", sets: 5, reps: "8", weight: 62.5 },
      { exercise: "Жим штанги лёжа", date: "2026-07-20", sets: 4, reps: "8", weight: 60 },
      { exercise: "[SKIP]", date: "2026-07-28", sets: null, reps: null, weight: null },
      { exercise: "Становая тяга", date: "2026-07-21", sets: 3, reps: "5", weight: 100 },
    ]);
    const result = await getPreviousWorkoutLogs(client, ["Жим Штанги Лёжа"]);
    const entry = result.get("жим штанги лёжа");
    expect(entry).toBeDefined();
    expect(entry?.weight).toBe(62.5);
    expect(entry?.sets).toBe(5);
    expect(result.size).toBe(1);
  });

  it("ignores unrelated exercises not in the plan", async () => {
    mockLogsQuery([
      { exercise: "Присед", date: "2026-07-20", sets: 4, reps: "8", weight: 80 },
    ]);
    const result = await getPreviousWorkoutLogs(client, ["Жим лёжа"]);
    expect(result.size).toBe(0);
  });

  it("queries with client_id filter, before-today and ordered by date desc", async () => {
    const builder = mockLogsQuery([]);
    await getPreviousWorkoutLogs(client, ["Присед"]);
    expect(builder.eq).toHaveBeenCalledWith("client_id", "client-1");
    expect(builder.lt).toHaveBeenCalledWith("date", expect.any(String));
    expect(builder.or).toHaveBeenCalledWith("exercise.ilike.присед");
    expect(builder.order).toHaveBeenCalledWith("date", { ascending: false });
  });

  it("escapes reserved and wildcard characters in or-filter", async () => {
    const builder = mockLogsQuery([]);
    await getPreviousWorkoutLogs(client, [
      "Жим лёжа (узкий хват)",
      "Тяга 50%",
      "Подтягивания с весом, 5кг",
    ]);
    expect(builder.or).toHaveBeenCalledWith(
      'exercise.ilike."жим лёжа (узкий хват)",exercise.ilike.тяга 50\\%,exercise.ilike."подтягивания с весом, 5кг"',
    );
  });

  it("degrades gracefully when query fails", async () => {
    mockLogsQuery([], { message: "boom" });
    const result = await getPreviousWorkoutLogs(client, ["Присед"]);
    expect(result.size).toBe(0);
  });
});

describe("isTodayWorkoutCompleted", () => {
  const client = {
    id: "client-1",
    program_id: "prog-1",
    timezone: "Europe/Moscow",
  } as Parameters<typeof isTodayWorkoutCompleted>[0];

  const workout = {
    week_number: 3,
    is_deload: false,
    goal: null,
    day_name: "Понедельник",
    days: [],
    exercises: [{ name: "Присед" }, { name: "Жим лёжа" }],
  } as Parameters<typeof isTodayWorkoutCompleted>[1];

  function mockTodayLogs(rows: Array<{ exercise?: string | null }>, error: { message: string } | null = null) {
    const eq2 = vi.fn(() => ({ data: rows, error }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const select = vi.fn(() => ({ eq: eq1 }));
    mocks.mockFrom.mockReturnValue({ select });
    return { select, eq1, eq2 };
  }

  it("returns false when only some exercises are logged", async () => {
    mockTodayLogs([{ exercise: "Присед" }]);
    expect(await isTodayWorkoutCompleted(client, workout)).toBe(false);
  });

  it("returns false without making a query when workout has no exercises", async () => {
    mocks.mockFrom.mockClear();
    await isTodayWorkoutCompleted(client, { ...workout, exercises: [] });
    expect(mocks.mockFrom).not.toHaveBeenCalled();
  });

  it("trims names on both sides", async () => {
    mockTodayLogs([{ exercise: "  Присед " }, { exercise: "жим лёжа" }]);
    expect(await isTodayWorkoutCompleted(client, {
      ...workout,
      exercises: [{ name: " Присед " }, { name: "Жим лёжа" }],
    })).toBe(true);
  });

  it("returns true when every exercise is logged today", async () => {
    mockTodayLogs([{ exercise: "Присед" }, { exercise: "жим лёжа" }]);
    expect(await isTodayWorkoutCompleted(client, workout)).toBe(true);
  });

  it("matches case-insensitively and ignores pseudo rows", async () => {
    mockTodayLogs([{ exercise: "присед" }, { exercise: "[SKIP]" }, { exercise: "ЖИМ ЛЁЖА" }]);
    expect(await isTodayWorkoutCompleted(client, workout)).toBe(true);
  });

  it("returns false when query fails", async () => {
    mockTodayLogs([], { message: "boom" });
    expect(await isTodayWorkoutCompleted(client, workout)).toBe(false);
  });

  it("returns false when no program is assigned", async () => {
    expect(await isTodayWorkoutCompleted({ ...client, program_id: null }, workout)).toBe(false);
  });

  it("filters today's logs by client and date", async () => {
    const { eq1, eq2 } = mockTodayLogs([]);
    await isTodayWorkoutCompleted(client, workout);
    expect(eq1).toHaveBeenCalledWith("client_id", "client-1");
    expect(eq2).toHaveBeenCalledWith("date", expect.any(String));
  });
});

describe("plannedDateForDay", () => {
  it("maps day names to dates in a Monday-anchored week", () => {
    expect(plannedDateForDay("2026-08-03", "понедельник")).toBe("2026-08-03");
    expect(plannedDateForDay("2026-08-03", "суббота")).toBe("2026-08-08");
    expect(plannedDateForDay("2026-08-03", "воскресенье")).toBe("2026-08-09");
  });

  it("maps day names to dates in a mid-week-anchored week", () => {
    // Week starts Wednesday 2026-08-05: Saturday of that window is 2026-08-08
    expect(plannedDateForDay("2026-08-05", "суббота")).toBe("2026-08-08");
    expect(plannedDateForDay("2026-08-05", "вторник")).toBe("2026-08-11");
  });

  it("returns null for unknown day names and invalid dates", () => {
    expect(plannedDateForDay("2026-08-03", "no-such-day")).toBeNull();
    expect(plannedDateForDay("not-a-date", "понедельник")).toBeNull();
  });
});

describe("getIsoWeekday", () => {
  it("returns 1 for Monday", () => {
    expect(getIsoWeekday("2026-08-03")).toBe(1);
  });

  it("returns 7 for Sunday", () => {
    expect(getIsoWeekday("2026-08-02")).toBe(7);
  });

  it("returns 6 for Saturday", () => {
    expect(getIsoWeekday("2026-08-01")).toBe(6);
  });

  it("returns 0 for an invalid date", () => {
    expect(getIsoWeekday("not-a-date")).toBe(0);
  });
});

describe("dayOrderForDate", () => {
  it("maps weekday index in training_days to 1-based order", () => {
    expect(dayOrderForDate("2026-08-04", [1, 2, 5])).toBe(2);
  });

  it("returns null for a rest day", () => {
    expect(dayOrderForDate("2026-08-04", [1, 6])).toBe(null);
  });

  it("returns null when training_days is empty", () => {
    expect(dayOrderForDate("2026-08-04", [])).toBe(null);
  });

  it("returns null when training_days is null", () => {
    expect(dayOrderForDate("2026-08-04", null)).toBe(null);
  });

  it("returns null for an invalid date", () => {
    expect(dayOrderForDate("bad", [1])).toBe(null);
  });
});

describe("matchDayByOrder", () => {
  const days = [
    { day_order: 1, day_name: "Понедельник", focus: null, exercises: [] },
    { day_order: 3, day_name: "Среда", focus: null, exercises: [] },
  ];

  it("finds the day with the matching order", () => {
    expect(matchDayByOrder(days, 3)?.day_name).toBe("Среда");
  });

  it("returns null when no day matches", () => {
    expect(matchDayByOrder(days, 2)).toBeNull();
  });

  it("returns null for an empty day list", () => {
    expect(matchDayByOrder([], 1)).toBeNull();
  });
});

describe("isPseudoName", () => {
  it("detects [SKIP] and [EVENING_*] rows", () => {
    expect(isPseudoName("[SKIP]")).toBe(true);
    expect(isPseudoName("[EVENING_ФОТО]")).toBe(true);
  });

  it("trims leading whitespace before checking", () => {
    expect(isPseudoName("  [SKIP]")).toBe(true);
  });

  it("rejects regular exercise names", () => {
    expect(isPseudoName("Присед")).toBe(false);
    expect(isPseudoName("Бег в скобках [тест]")).toBe(false);
  });
});

describe("getTodayISODay", () => {
  const system = new Date("2026-08-06T20:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(system);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 1 for Monday in a fixed timezone", () => {
    vi.setSystemTime(new Date("2026-08-03T12:00:00Z"));
    expect(getTodayISODay("Europe/Moscow")).toBe(1);
  });

  it("returns 4 for Thursday in Europe/Moscow", () => {
    expect(getTodayISODay("Europe/Moscow")).toBe(4);
  });

  it("returns 4 for Thursday where UTC-7 is still same day", () => {
    expect(getTodayISODay("America/Los_Angeles")).toBe(4);
  });

  it("returns 5 for Friday where UTC+9 already crossed midnight", () => {
    expect(getTodayISODay("Asia/Tokyo")).toBe(5);
  });

  it("returns 7 for Sunday", () => {
    vi.setSystemTime(new Date("2026-08-09T12:00:00Z"));
    expect(getTodayISODay("Europe/Moscow")).toBe(7);
  });

  it("throws for an invalid timezone", () => {
    expect(() => getTodayISODay("Not/AZone")).toThrow();
  });
});

describe("getTodayDayOfMonth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T20:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns day of month in client timezone", () => {
    expect(getTodayDayOfMonth("Europe/Moscow")).toBe(6);
  });

  it("returns next day where UTC+9 already crossed midnight", () => {
    expect(getTodayDayOfMonth("Asia/Tokyo")).toBe(7);
  });

  it("returns first of month", () => {
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));
    expect(getTodayDayOfMonth("Europe/Moscow")).toBe(1);
  });

  it("returns last day of month", () => {
    vi.setSystemTime(new Date("2026-08-31T12:00:00Z"));
    expect(getTodayDayOfMonth("Europe/Moscow")).toBe(31);
  });

  it("throws for an invalid timezone", () => {
    expect(() => getTodayDayOfMonth("Not/AZone")).toThrow();
  });
});

describe("parseTimeRounded", () => {
  it("keeps exact quarter-hour", () => {
    expect(parseTimeRounded("10:00")).toEqual({ hour: 10, minute: 0 });
    expect(parseTimeRounded("10:15")).toEqual({ hour: 10, minute: 15 });
    expect(parseTimeRounded("10:30")).toEqual({ hour: 10, minute: 30 });
    expect(parseTimeRounded("10:45")).toEqual({ hour: 10, minute: 45 });
  });

  it("rounds minutes down within quarter", () => {
    expect(parseTimeRounded("10:07")).toEqual({ hour: 10, minute: 0 });
  });

  it("rounds minutes up to next quarter", () => {
    expect(parseTimeRounded("10:08")).toEqual({ hour: 10, minute: 15 });
    expect(parseTimeRounded("10:53")).toEqual({ hour: 11, minute: 0 });
  });

  it("rolls over to next hour at 22:53", () => {
    expect(parseTimeRounded("22:53")).toEqual({ hour: 23, minute: 0 });
  });

  it("clamps at end of day instead of rolling past 23:59", () => {
    expect(parseTimeRounded("23:46")).toEqual({ hour: 23, minute: 45 });
    expect(parseTimeRounded("23:53")).toEqual({ hour: 23, minute: 45 });
  });

  it("rounds hour-zero edge at 00:07", () => {
    expect(parseTimeRounded("00:07")).toEqual({ hour: 0, minute: 0 });
    expect(parseTimeRounded("00:08")).toEqual({ hour: 0, minute: 15 });
  });

  it("returns null for invalid/missing input", () => {
    expect(parseTimeRounded("")).toBeNull();
    expect(parseTimeRounded("abc")).toBeNull();
    expect(parseTimeRounded("25:00")).toBeNull();
    expect(parseTimeRounded("10:60")).toBeNull();
    expect(parseTimeRounded("10")).toBeNull();
  });
});
