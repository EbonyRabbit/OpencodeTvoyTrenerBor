import { describe, it, expect } from "vitest";
import { buildProgramInstructions } from "../program-instructions";

describe("buildProgramInstructions", () => {
  it("builds a full ru message with program, code and bot", () => {
    const text = buildProgramInstructions({
      name: "Иван",
      language: "ru",
      programTitle: "Сила 12 недель",
      accessEndDate: "2026-01-01T00:00:00.000Z",
      connectCode: "ABC12345",
      botUsername: "@test_bot",
      timezone: "Europe/Moscow",
    });

    expect(text).toContain("Привет, Иван!");
    expect(text).toContain("Программа: Сила 12 недель");
    expect(text).toContain("Доступ действует до");
    expect(text).toContain("t.me/test_bot");
    expect(text).toContain("Введи код подключения: ABC12345");
    expect(text).toContain("1. Открой бота");
    expect(text).toContain("2. Введи код подключения");
    expect(text).toContain("3. Настрой тренировки и замеры");
    expect(text).toContain("4. Начни первую тренировку: /today");
    expect(text).toContain("5. Программа и план всегда в /menu");
    expect(text).toContain("дни тренировок");
    expect(text).toContain("день и время замеров");
    expect(text).toContain("день и время чек-ина");
    expect(text).toContain("/settings");
  });

  it("builds an en message", () => {
    const text = buildProgramInstructions({
      name: "John",
      language: "en",
      programTitle: "Strength 12 weeks",
      accessEndDate: "2026-01-01T00:00:00.000Z",
    });

    expect(text).toContain("Hi, John!");
    expect(text).toContain("Program: Strength 12 weeks");
    expect(text).toContain("training days");
    expect(text).toContain("measurement day and time");
    expect(text).toContain("check-in day and time");
  });

  it("numbers steps sequentially when connect code is absent", () => {
    const text = buildProgramInstructions({
      name: "Иван",
      language: "ru",
      programTitle: "Программа",
      accessEndDate: null,
      connectCode: null,
    });

    expect(text).not.toContain("Введи код подключения");
    expect(text).toContain("1. Открой бота");
    expect(text).toContain("2. Настрой тренировки и замеры");
    expect(text).toContain("3. Начни первую тренировку: /today");
    expect(text).toContain("4. Программа и план всегда в /menu");
    expect(text).not.toMatch(/\n5\. /);
    expect(text).not.toContain("3. Настрой тренировки и замеры");
  });

  it("uses the default name when name is empty", () => {
    const ru = buildProgramInstructions({
      name: "",
      language: "ru",
      programTitle: "Программа",
      accessEndDate: null,
    });
    expect(ru).toContain("Привет, друг!");

    const en = buildProgramInstructions({
      name: "   ",
      language: "en",
      programTitle: "Program",
      accessEndDate: null,
    });
    expect(en).toContain("Hi, friend!");
  });

  it("omits access date when not provided", () => {
    const text = buildProgramInstructions({
      name: "Иван",
      language: "ru",
      programTitle: "Программа",
      accessEndDate: null,
    });

    expect(text).not.toContain("Доступ действует до");
  });

  it("omits bot link when botUsername is not provided", () => {
    const text = buildProgramInstructions({
      name: "Иван",
      language: "ru",
      programTitle: "Программа",
      accessEndDate: "2026-01-01T00:00:00.000Z",
      connectCode: "ABC12345",
    });

    expect(text).toContain("Открой бота и нажми /start");
    expect(text).not.toContain("t.me/");
  });

  it("sanitizes bot username", () => {
    const text = buildProgramInstructions({
      name: "Иван",
      language: "ru",
      programTitle: "Программа",
      accessEndDate: null,
      botUsername: "@my bot",
    });

    expect(text).toContain("t.me/mybot");
    expect(text).not.toContain("t.me/@");
  });

  it("falls back to ru when language is null", () => {
    const text = buildProgramInstructions({
      name: "Иван",
      language: null,
      programTitle: "Программа",
      accessEndDate: null,
    });

    expect(text).toContain("Привет, Иван!");
    expect(text).toContain("Что делать дальше:");
  });

  it("includes numbered connect-code step in en message when present", () => {
    const text = buildProgramInstructions({
      name: "John",
      language: "en",
      programTitle: "Program",
      accessEndDate: null,
      connectCode: "ABC12345",
    });

    expect(text).toContain("1. Open the bot");
    expect(text).toContain("2. Enter the connect code: ABC12345");
    expect(text).toContain("3. Set up your workouts and measurements");
    expect(text).toContain("4. Start your first workout: /today");
  });

  it("shifts the access date according to the client timezone", () => {
    const base = buildProgramInstructions({
      name: "Иван",
      language: "ru",
      programTitle: "Программа",
      accessEndDate: "2026-01-01T00:00:00.000Z",
      timezone: "America/Los_Angeles",
    });
    const other = buildProgramInstructions({
      name: "Иван",
      language: "ru",
      programTitle: "Программа",
      accessEndDate: "2026-01-01T00:00:00.000Z",
      timezone: "Asia/Tokyo",
    });

    expect(base).toContain("31.12.2025");
    expect(other).toContain("01.01.2026");
  });

  it("does not throw and omits the date line on an invalid access date", () => {
    const text = buildProgramInstructions({
      name: "Иван",
      language: "ru",
      programTitle: "Программа",
      accessEndDate: "not-a-date",
      timezone: "Not/AZone",
    });

    expect(text).toBeTypeOf("string");
    expect(text).not.toContain("Доступ действует до");
    expect(text).not.toContain("Invalid Date");
  });

  it("falls back to the locale date when the timezone is invalid", () => {
    const text = buildProgramInstructions({
      name: "Иван",
      language: "ru",
      programTitle: "Программа",
      accessEndDate: "2026-01-01T00:00:00.000Z",
      timezone: "Not/AZone",
    });

    expect(text).toContain("Доступ действует до");
    expect(text).not.toContain("Invalid Date");
  });
});